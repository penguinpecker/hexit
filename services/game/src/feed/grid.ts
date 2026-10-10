// Config, the 100 ms grid timer and the chrony clock gate.
import { execFile } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, type WriteStream } from 'node:fs';
import { ASSET_ID, parseE8, TICK_MS, type Asset, type IndexConfig, type Sample } from './index.ts';
import { VENUES } from './sources.ts';

export interface FeedConfig {
  assets: Asset[];
  venues: string[];
  staleMs: number;
  maxQuoteAgeMs: number;
  maxSpreadBps: number;
  outlierBps: number;
  minVenues: number;
  usdt: { windowMs: number; min: string; max: string };
  gapMs: number;
  maxTickAgeMs: number;
  clock: { source: 'chrony' | 'none'; maxOffsetMs: number; checkEveryMs: number };
  archiveDir: string;
}

// BTC/USD and MON/USD (owner, 2026-10-10). Venues, spread and staleness from the 2026-10-10 replay of a live capture:
// MON's books are wider (Gate 12 bps median) and its quiet venues go silent for over 1 s; at 20 bps / 2 s neither index
// had a gap over 250 ms. Perpl joined the median the same day (owner): alone it paused over 2 s and its BTC book sat
// still for a minute, so it is one venue among the exchanges. Binance never quotes MON, so MON has 6 venues and BTC 7;
// the floor makes the quorum 4 (2 live minutes at 4: no gap on either, Perpl inside 99 % of ticks).
export const DEFAULTS: FeedConfig = {
  assets: ['BTC', 'MON'],
  venues: ['binance', 'okx', 'bybit', 'coinbase', 'kraken', 'gate', 'perpl'],
  staleMs: 2000,
  maxQuoteAgeMs: 60_000,
  maxSpreadBps: 20,
  outlierBps: 15,
  minVenues: 4,
  usdt: { windowMs: 60_000, min: '0.98', max: '1.02' },
  gapMs: 250,
  maxTickAgeMs: 2500,
  clock: { source: 'chrony', maxOffsetMs: 50, checkEveryMs: 10_000 },
  archiveDir: 'archive',
};

export function loadConfig(path?: string): FeedConfig {
  const c: FeedConfig = { ...DEFAULTS, ...(path ? JSON.parse(readFileSync(path, 'utf8')) : {}) };
  for (const v of c.venues) if (!VENUES[v]) throw new Error(`unknown venue ${v}`);
  for (const a of c.assets) if (!(a in ASSET_ID)) throw new Error(`unknown asset ${a}`);
  // Quorum floor: fresh >= 2 and fresh >= ceil(configured / 2)
  if (c.minVenues < Math.max(2, Math.ceil(c.venues.length / 2))) throw new Error('minVenues below max(2, ceil(venues/2))');
  return c;
}

export function indexConfig(c: FeedConfig): IndexConfig {
  const e8 = (s: string) => { const v = parseE8(s); if (v === null) throw new Error(`bad usdt bound ${s}`); return v; };
  return {
    assets: c.assets,
    venues: c.venues.map((name) => ({ name, quote: VENUES[name].quote })),
    staleMs: c.staleMs, maxQuoteAgeMs: c.maxQuoteAgeMs, maxSpreadBps: c.maxSpreadBps,
    outlierBps: c.outlierBps, minVenues: c.minVenues,
    usdt: { windowMs: c.usdt.windowMs, minE8: e8(c.usdt.min), maxE8: e8(c.usdt.max) },
  };
}

/** Calls fn(t) for every grid instant t = 100·n ms, in order, including any missed during an event-loop stall. */
export function runGrid(fn: (t: number) => void): { stop(): void } {
  let next = Math.floor(Date.now() / TICK_MS) * TICK_MS + TICK_MS;
  let timer: NodeJS.Timeout;
  const loop = () => {
    while (Date.now() >= next) { fn(next); next += TICK_MS; }
    timer = setTimeout(loop, next - Date.now());
  };
  timer = setTimeout(loop, next - Date.now());
  return { stop: () => clearTimeout(timer) };
}

/** Clock offset in ms from `chronyc -c tracking` (field 5 = system time offset, seconds). */
export function parseChrony(csv: string): number | null {
  const f = csv.trim().split(',');
  const s = Number(f[4]);
  return f.length > 5 && Number.isFinite(s) ? Math.abs(s * 1000) : null;
}

/** Polls chrony; ok() is false until a good reading arrives and whenever the offset is too large or unreadable. */
export function clockGate(c: FeedConfig['clock'], onLog: (m: string) => void) {
  if (c.source === 'none') return { ok: () => true, offsetMs: () => null as number | null, stop() {} };
  let offset: number | null = null;
  const poll = () => execFile('chronyc', ['-c', 'tracking'], (err, out) => {
    offset = err ? null : parseChrony(out);
    if (offset === null || offset > c.maxOffsetMs) onLog(`clock gate closed: offset ${offset ?? 'unreadable'} ms`);
  });
  poll();
  const iv = setInterval(poll, c.checkEveryMs);
  return { ok: () => offset !== null && offset <= c.maxOffsetMs, offsetMs: () => offset, stop: () => clearInterval(iv) };
}

/** The archive form of a grid sample (also what replay compares). */
export function sampleRecord(s: Sample): Record<string, unknown> {
  return s.kind === 'tick'
    ? { e: 'tick', asset: s.asset, ts: s.ts, price_e8: s.price_e8.toString(), sources: s.sources }
    : { e: 'gap', asset: s.asset, ts: s.ts, reason: s.reason, fresh: s.fresh };
}

/** Append-only JSONL archive, one file per UTC day: every input event and every grid output, in order. */
export class Archive {
  private dir: string;
  private day = '';
  private out: WriteStream | null = null;
  constructor(dir: string) { this.dir = dir; mkdirSync(dir, { recursive: true }); }
  write(rec: object): void {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.day) { this.out?.end(); this.out = createWriteStream(`${this.dir}/feed-${day}.jsonl`, { flags: 'a' }); this.day = day; }
    this.out!.write(JSON.stringify(rec) + '\n');
  }
  close(): Promise<void> { return new Promise((done) => (this.out ? this.out.end(done) : done())); }
}
