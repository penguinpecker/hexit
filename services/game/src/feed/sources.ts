// Public, keyless exchange websockets (best bid/offer). Endpoints and channels verified live 2026-10-06; Gate and the
// MON symbols on all six 2026-10-10 (Binance has no MON spot market: it accepts the MON stream and never quotes it).
// Each connection also subscribes to BTC as a liveness canary, and USD venues
// subscribe to USDT for the USDT/USD leg.
import type { FeedEvent } from './index.ts';

export interface Venue {
  name: string;
  quote: 'USD' | 'USDT';
  url(syms: string[]): string;
  subs(syms: string[]): unknown[];
  ping?: { everyMs: number; msg: string };
  /** venue message -> quotes [venue symbol, bid, ask, exchange ts ms?] */
  parse(m: any): [string, string, string, number?][];
  sym(s: string): string;   // our symbol -> venue symbol
}

const num = (x: unknown) => (typeof x === 'number' ? String(x) : (x as string));  // Kraken sends JSON numbers

export const VENUES: Record<string, Venue> = {
  binance: {
    name: 'binance', quote: 'USDT',
    url: (s) => `wss://stream.binance.com:9443/stream?streams=${s.map((x) => x.toLowerCase() + '@bookTicker').join('/')}`,
    subs: () => [],
    parse: (m) => (m.data?.s ? [[m.data.s, m.data.b, m.data.a]] : []),
    sym: (s) => `${s}USDT`,
  },
  okx: {
    name: 'okx', quote: 'USDT',
    url: () => 'wss://ws.okx.com:8443/ws/v5/public',
    subs: (s) => [{ op: 'subscribe', args: s.map((instId) => ({ channel: 'bbo-tbt', instId })) }],
    ping: { everyMs: 25_000, msg: 'ping' },
    parse: (m) => (m.arg?.channel === 'bbo-tbt' && m.data?.[0]?.bids?.[0] && m.data[0].asks?.[0]
      ? [[m.arg.instId, m.data[0].bids[0][0], m.data[0].asks[0][0], Number(m.data[0].ts)]] : []),
    sym: (s) => `${s}-USDT`,
  },
  bybit: {
    name: 'bybit', quote: 'USDT',
    url: () => 'wss://stream.bybit.com/v5/public/spot',
    subs: (s) => [{ op: 'subscribe', args: s.map((x) => `orderbook.1.${x}`) }],
    ping: { everyMs: 20_000, msg: '{"op":"ping"}' },
    // orderbook.1 pushes full top-of-book snapshots; skip any message missing a side
    parse: (m) => (m.topic?.startsWith('orderbook.1.') && m.data?.b?.[0] && m.data.a?.[0]
      ? [[m.data.s, m.data.b[0][0], m.data.a[0][0], m.cts ?? m.ts]] : []),
    sym: (s) => `${s}USDT`,
  },
  coinbase: {
    name: 'coinbase', quote: 'USD',
    url: () => 'wss://advanced-trade-ws.coinbase.com',
    // ponytail: `ticker` refreshes best bid/ask on trades only; switch to level2 if its mids lag the median
    subs: (s) => [{ type: 'subscribe', product_ids: s, channel: 'ticker' }, { type: 'subscribe', channel: 'heartbeats' }],
    parse: (m) => (m.channel !== 'ticker' ? [] : (m.events ?? []).flatMap((e: any) => (e.tickers ?? [])
      .filter((t: any) => t.best_bid && t.best_ask)
      .map((t: any) => [t.product_id, t.best_bid, t.best_ask, Date.parse(m.timestamp)]))),
    sym: (s) => `${s}-USD`,
  },
  kraken: {
    name: 'kraken', quote: 'USD',
    url: () => 'wss://ws.kraken.com/v2',
    subs: (s) => [{ method: 'subscribe', params: { channel: 'ticker', symbol: s, event_trigger: 'bbo' } }],
    ping: { everyMs: 30_000, msg: '{"method":"ping"}' },
    parse: (m) => (m.channel !== 'ticker' ? [] : (m.data ?? [])
      .map((t: any) => [t.symbol, num(t.bid), num(t.ask), t.timestamp ? Date.parse(t.timestamp) : undefined])),
    sym: (s) => `${s}/USD`,
  },
  gate: {
    name: 'gate', quote: 'USDT',
    url: () => 'wss://api.gateio.ws/ws/v4/',
    subs: (s) => [{ time: Math.floor(Date.now() / 1000), channel: 'spot.book_ticker', event: 'subscribe', payload: s }],
    ping: { everyMs: 20_000, msg: '{"channel":"spot.ping"}' },
    parse: (m) => (m.channel === 'spot.book_ticker' && m.event === 'update' && m.result?.b && m.result?.a
      ? [[m.result.s, m.result.b, m.result.a, m.result.t]] : []),
    sym: (s) => `${s}_USDT`,
  },
};

/** Our symbols a venue must subscribe to for these assets. */
export function venueSymbols(v: Venue, assets: string[]): string[] {
  const s = new Set([...assets, 'BTC']);
  if (v.quote === 'USD') s.add('USDT');
  return [...s];
}

/**
 * Keeps one venue connected forever (reconnect with backoff). Every quote becomes a FeedEvent stamped
 * with host receive time; a closed socket emits a 'down' event so the index drops the venue at once.
 */
export function connect(v: Venue, assets: string[], onEvent: (ev: FeedEvent) => void,
                        onLog: (msg: string) => void = () => {}): { close(): void } {
  const ours = venueSymbols(v, assets);
  const back = new Map(ours.map((s) => [v.sym(s), s]));
  let ws: WebSocket | null = null, ping: NodeJS.Timeout | undefined, retry: NodeJS.Timeout | undefined;
  let delay = 1000, closed = false, lastMsg = Date.now();
  // a socket that goes silent without closing is closed here so it reconnects
  const watchdog = setInterval(() => { if (Date.now() - lastMsg > 30_000) { lastMsg = Date.now(); ws?.close(); } }, 5000);

  const open = () => {
    const sock = new WebSocket(v.url(ours.map(v.sym)));
    ws = sock;
    sock.onopen = () => {
      delay = 1000; lastMsg = Date.now();
      onLog(`${v.name} open`);
      for (const s of v.subs(ours.map(v.sym))) sock.send(JSON.stringify(s));
      if (v.ping) ping = setInterval(() => sock.send(v.ping!.msg), v.ping.everyMs);
    };
    sock.onmessage = (e) => {
      const r = (lastMsg = Date.now());
      let m: any;
      try { m = JSON.parse(String(e.data)); } catch { return; }   // 'pong' etc.
      for (const [vs, b, a, x] of v.parse(m)) {
        const s = back.get(vs);
        if (s && typeof b === 'string' && typeof a === 'string') onEvent({ e: 'q', v: v.name, s, b, a, r, ...(x ? { x } : {}) });
      }
    };
    sock.onerror = () => {};   // onclose follows
    sock.onclose = (e) => {
      clearInterval(ping);
      onEvent({ e: 'down', v: v.name, r: Date.now() });
      onLog(`${v.name} closed ${e.code} ${e.reason}`);
      if (!closed) { retry = setTimeout(open, delay); delay = Math.min(delay * 2, 30_000); }
    };
  };
  open();
  return { close() { closed = true; clearTimeout(retry); clearInterval(watchdog); ws?.close(); } };
}
