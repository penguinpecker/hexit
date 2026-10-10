// Hexit Index: median of fresh venue mids, sampled on a fixed 100 ms grid.
// Pure and deterministic: the same event sequence gives the same ticks, live or in replay.
// Rules: venues, USDT leg, spread/outlier/quorum, plus
// integer e8 prices from decimal strings, floored even median, no carry-forward of ticks.

export type Asset = 'SOL' | 'BTC' | 'ETH' | 'MON';
/** HexitGame's market ids (contracts/README.md "Markets"). */
export const ASSET_ID: Record<Asset, number> = { SOL: 0, BTC: 1, ETH: 2, MON: 3 };
export const TICK_MS = 100;
const E8 = 100_000_000n;

/** One archived/replayable input. `s` is our symbol (an Asset or USDT), prices are decimal strings. */
export type FeedEvent =
  | { e: 'q'; v: string; s: string; b: string; a: string; r: number; x?: number }
  | { e: 'down'; v: string; r: number };

export type Sample =
  | { kind: 'tick'; asset: Asset; ts: number; price_e8: bigint; sources: string[] }
  | { kind: 'gap'; asset: Asset; ts: number; reason: string; fresh: number };

export interface IndexConfig {
  assets: Asset[];
  venues: { name: string; quote: 'USD' | 'USDT' }[];
  staleMs: number;        // venue is live if any quote message arrived within this window
  maxQuoteAgeMs: number;  // guard against a dead single-symbol subscription on a live socket
  maxSpreadBps: number;
  outlierBps: number;
  minVenues: number;
  usdt: { windowMs: number; minE8: bigint; maxE8: bigint };
}

/** Decimal string -> integer 1e-8 units, truncating digits past 8. Null if not a plain positive-or-zero decimal. */
export function parseE8(s: string): bigint | null {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * E8 + BigInt(((m[2] ?? '') + '00000000').slice(0, 8));
}

export function median(xs: bigint[]): bigint {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2n;
}

const absB = (x: bigint) => (x < 0n ? -x : x);

interface Quote { bid: bigint; ask: bigint; r: number }
interface VenueState { lastMsg: number; quotes: Map<string, Quote> }

export class HexitIndex {
  cfg: IndexConfig;
  private queue: FeedEvent[] = [];
  private venues = new Map<string, VenueState>();
  private usdtWin: { t: number; v: bigint }[] = [];

  constructor(cfg: IndexConfig) { this.cfg = cfg; }

  /** Events must be pushed in arrival order. They are applied only when a grid instant passes them. */
  push(ev: FeedEvent): void { this.queue.push(ev); }

  private apply(ev: FeedEvent): void {
    if (ev.e === 'down') { this.venues.delete(ev.v); return; }
    const bid = parseE8(ev.b), ask = parseE8(ev.a);
    let st = this.venues.get(ev.v);
    if (!st) this.venues.set(ev.v, (st = { lastMsg: ev.r, quotes: new Map() }));
    st.lastMsg = ev.r;
    if (bid === null || ask === null) return;
    st.quotes.set(ev.s, { bid, ask, r: ev.r });
  }

  /** Clean mid of `sym` on venue `v` as of t, or a reason it is unusable. */
  private mid(v: string, sym: string, t: number): bigint | string {
    const st = this.venues.get(v);
    if (!st || t - st.lastMsg > this.cfg.staleMs) return 'stale';
    const q = st.quotes.get(sym);
    if (!q || t - q.r > this.cfg.maxQuoteAgeMs) return 'noquote';
    if (q.bid <= 0n || q.ask < q.bid) return 'crossed';
    const mid = (q.bid + q.ask) / 2n;
    if ((q.ask - q.bid) * 10_000n > BigInt(this.cfg.maxSpreadBps) * mid) return 'spread';
    return mid;
  }

  /** USDT/USD (e8) as the windowed mean of USD venues' USDT mids; null if none seen in the window. */
  private usdtRate(t: number): bigint | null {
    const now: bigint[] = [];
    for (const v of this.cfg.venues) {
      if (v.quote !== 'USD') continue;
      const m = this.mid(v.name, 'USDT', t);
      if (typeof m === 'bigint') now.push(m);
    }
    if (now.length) this.usdtWin.push({ t, v: now.reduce((a, b) => a + b) / BigInt(now.length) });
    while (this.usdtWin.length && this.usdtWin[0].t <= t - this.cfg.usdt.windowMs) this.usdtWin.shift();
    if (!this.usdtWin.length) return null;
    return this.usdtWin.reduce((a, b) => a + b.v, 0n) / BigInt(this.usdtWin.length);
  }

  /** Index values at grid instant t (one per asset; each asset needs its own quorum, so one can gap while another ticks).
   *  Uses only events received strictly before t. */
  sampleAt(t: number): Sample[] {
    while (this.queue.length && this.queue[0].r < t) this.apply(this.queue.shift()!);
    const rate = this.usdtRate(t);
    const { usdt } = this.cfg;
    const depeg = rate !== null && (rate < usdt.minE8 || rate > usdt.maxE8);
    return this.cfg.assets.map((asset): Sample => {
      if (depeg) return { kind: 'gap', asset, ts: t, reason: 'usdt-depeg', fresh: 0 };
      const c: { v: string; mid: bigint }[] = [];
      for (const v of this.cfg.venues) {
        let m = this.mid(v.name, asset, t);
        if (typeof m !== 'bigint') continue;
        if (v.quote === 'USDT') { if (rate === null) continue; m = (m * rate) / E8; }
        c.push({ v: v.name, mid: m });
      }
      if (c.length < this.cfg.minVenues) return { kind: 'gap', asset, ts: t, reason: 'quorum', fresh: c.length };
      const m1 = median(c.map((x) => x.mid));
      const kept = c.filter((x) => absB(x.mid - m1) * 10_000n <= BigInt(this.cfg.outlierBps) * m1);
      if (kept.length < this.cfg.minVenues) return { kind: 'gap', asset, ts: t, reason: 'outliers', fresh: kept.length };
      return { kind: 'tick', asset, ts: t, price_e8: median(kept.map((x) => x.mid)), sources: kept.map((x) => x.v) };
    });
  }
}
