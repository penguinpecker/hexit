// Public, keyless exchange websockets (best bid/offer). Endpoints and channels verified live 2026-10-06; Gate and the
// MON symbols on all six 2026-10-10 (Binance has no MON spot market: it accepts the MON stream and never quotes it).
// Each connection also subscribes to BTC as a liveness canary, and USD venues
// subscribe to USDT for the USDT/USD leg. Perpl (end of the table) joined the median on 2026-10-10.
import { ASSET_ID, type Asset, type FeedEvent } from './index.ts';

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
  perpl: perplVenue(),
};

/** A Perpl testnet fill as the app's feed shows it (GET /perpl, SSE event 'perpl'): its Monad transaction, market, taker
 *  side, price (USD) and size (base units) as decimal strings, notional in USD to the cent. id = tx:l, l being the fill's
 *  log index inside its transaction (checked against receipts 2026-10-11). */
export type PerplTrade = { id: string; kind: 'perpl'; tx: `0x${string}`; block: number; ts: number; asset: number; symbol: string;
  side: 'buy' | 'sell'; price: string; size: string; notional: string };
/** Called with each batch of Perpl fills; snapshot: the recent fills Perpl resends on every (re)subscribe, not new ones. */
export const perplTrades = new Set<(t: PerplTrade[], snapshot: boolean) => void>();

/** Perpl, the on-chain perp exchange on Monad (owner, 2026-10-10: "just use their apis"; then: live trades on testnet):
 *  its Monad TESTNET order books over the public market-data websocket (no key; 10 requests/min and 16 subscriptions per
 *  connection, so one subscribe frame and no app pings). Market ids and price decimals read live 2026-10-10 from
 *  https://testnet.perpl.xyz/api/v1/pub/context (mainnet, used before: wss://app.perpl.xyz, chain 143, BTC 1/dp 1,
 *  MON 10/dp 6).
 *  The book is kept from snapshots (mt 15) and updates (mt 16, a level with o 0 is gone). It can sit unchanged for
 *  10-25 s, so every block heartbeat (mt 100, ~0.3 s) re-sends the best bid/ask: the book is current as of that block.
 *  The same frame takes each market's trades (mt 17: recent fills on subscribe, mt 18: new ones) for perplTrades; they are
 *  no quotes. Perpl sends txid without 0x and leaves out a zero tx or l. */
function perplVenue(): Venue {
  const MKT: Record<string, { id: number; dp: number; sd: number }> = { BTC: { id: 16, dp: 1, sd: 5 }, MON: { id: 64, dp: 5, sd: 0 } };
  const byId = new Map(Object.entries(MKT).map(([s, m]) => [String(m.id), { ...m, s }]));
  const sids = new Map<number, string>(), books = new Map<string, { bid: Map<number, number>; ask: Map<number, number> }>();
  const dec = (p: number | bigint, dp: number) => { const s = String(p).padStart(dp + 1, '0'); return dp ? `${s.slice(0, -dp)}.${s.slice(-dp)}` : s; };
  const bbo = (id: string): [string, string, string][] => {
    const b = books.get(id), dp = byId.get(id)!.dp;
    if (!b?.bid.size || !b.ask.size) return [];
    return [[id, dec(Math.max(...b.bid.keys()), dp), dec(Math.min(...b.ask.keys()), dp)]];
  };
  const pos = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) > 0;
  const trade = (t: any, m: { s: string; dp: number; sd: number }): PerplTrade[] => {
    const h = /^(?:0x)?([0-9a-fA-F]{64})$/.exec(t?.at?.txid)?.[1], l = t?.at?.l ?? 0;
    if (!h || !Number.isSafeInteger(l) || l < 0 || !pos(t.at.b) || !pos(t.at.t) || !pos(t.p) || !pos(t.s) || (t.sd !== 1 && t.sd !== 2)) return [];
    const tx = `0x${h.toLowerCase()}` as const, D = 10n ** BigInt(m.dp + m.sd);
    return [{ id: `${tx}:${l}`, kind: 'perpl', tx, block: t.at.b, ts: t.at.t, asset: ASSET_ID[m.s as Asset], symbol: `${m.s}/USD`,
      side: t.sd === 1 ? 'buy' : 'sell', price: dec(t.p, m.dp), size: dec(t.s, m.sd),
      notional: dec((BigInt(t.p) * BigInt(t.s) * 200n + D) / (2n * D), 2) }];   // price x size in cents, half up
  };
  return {
    name: 'perpl', quote: 'USD',   // AUSD collateral, priced in US dollars
    url: () => 'wss://testnet.perpl.xyz/ws/v1/market-data',
    subs: (ids) => { const ms = ids.filter((id) => byId.has(id));
      return [{ mt: 5, subs: ['heartbeat@10143', ...ms.map((id) => `order-book@${id}`), ...ms.map((id) => `trades@${id}`)]
        .map((stream) => ({ stream, subscribe: true })) }]; },
    parse: (m) => {
      if (m.mt === 6) {   // subscription ids for this connection; a reconnect starts a fresh book from its snapshot
        for (const x of m.subs ?? []) { const id = /^(?:order-book|trades)@(\d+)$/.exec(x.stream)?.[1]; if (id && x.sid != null) sids.set(x.sid, id); }
        return [];
      }
      if (m.mt === 15 || m.mt === 16) {
        const id = sids.get(m.sid); if (!id) return [];
        let b = books.get(id);
        if (!b || m.mt === 15) books.set(id, (b = { bid: new Map(), ask: new Map() }));
        for (const [side, lv] of [[b.bid, m.bid], [b.ask, m.ask]] as const)
          for (const l of lv ?? []) (l.o === 0 ? side.delete(l.p) : side.set(l.p, l.s));
        return bbo(id);
      }
      if (m.mt === 17 || m.mt === 18) {
        const mk = byId.get(sids.get(m.sid) ?? ''), ts: PerplTrade[] = mk && Array.isArray(m.d) ? m.d.flatMap((t: any) => trade(t, mk)) : [];
        if (ts.length) for (const f of perplTrades) f(ts, m.mt === 17);
        return [];
      }
      return m.mt === 100 ? [...byId.keys()].flatMap(bbo) : [];
    },
    sym: (s) => (MKT[s] ? String(MKT[s].id) : s),
  };
}

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
