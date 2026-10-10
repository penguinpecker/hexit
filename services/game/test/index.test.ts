import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HexitIndex, median, parseE8, type FeedEvent, type IndexConfig, type Sample } from '../src/feed/index.ts';
import { VENUES, venueSymbols } from '../src/feed/sources.ts';
import { indexConfig, loadConfig } from '../src/feed/grid.ts';

const cfg = (over: Partial<IndexConfig> = {}): IndexConfig => ({
  assets: ['SOL'],
  venues: [
    { name: 'binance', quote: 'USDT' }, { name: 'okx', quote: 'USDT' }, { name: 'bybit', quote: 'USDT' },
    { name: 'coinbase', quote: 'USD' }, { name: 'kraken', quote: 'USD' },
  ],
  staleMs: 1000, maxQuoteAgeMs: 60_000, maxSpreadBps: 10, outlierBps: 15, minVenues: 3,
  usdt: { windowMs: 60_000, minE8: 98_000_000n, maxE8: 102_000_000n },
  ...over,
});
const q = (v: string, s: string, b: string, a: string, r: number): FeedEvent => ({ e: 'q', v, s, b, a, r });
const run = (c: IndexConfig, evs: FeedEvent[], t: number): Sample => {
  const idx = new HexitIndex(c);
  evs.forEach((e) => idx.push(e));
  return idx.sampleAt(t)[0];
};
const usdOnly = cfg({ venues: [{ name: 'a', quote: 'USD' }, { name: 'b', quote: 'USD' }, { name: 'c', quote: 'USD' }, { name: 'd', quote: 'USD' }] });

test('parseE8: decimal strings to integer 1e-8, no floats', () => {
  assert.equal(parseE8('121.07'), 12_107_000_000n);
  assert.equal(parseE8('85973.91000000'), 8_597_391_000_000n);
  assert.equal(parseE8('0.99989'), 99_989_000n);
  assert.equal(parseE8('7'), 700_000_000n);
  assert.equal(parseE8('1.123456789'), 112_345_678n);   // truncates past 8 decimals
  for (const bad of ['', '-1', '1e-7', 'abc', '1.2.3']) assert.equal(parseE8(bad), null);
});

test('median: odd middle, even floored mean', () => {
  assert.equal(median([3n, 1n, 2n]), 2n);
  assert.equal(median([1n, 4n]), 2n);   // 2.5 floors
  assert.equal(median([10n, 2n, 7n, 4n]), 5n);   // (4+7)/2 = 5.5 floors
  assert.equal(median([5n]), 5n);
});

test('quorum: 3 fresh venues tick, 2 are a gap', () => {
  const evs = [q('a', 'SOL', '100.00', '100.02', 0), q('b', 'SOL', '100.01', '100.03', 0), q('c', 'SOL', '100.02', '100.04', 0)];
  const s = run(usdOnly, evs, 100);
  assert.equal(s.kind, 'tick');
  assert.equal(s.kind === 'tick' && s.price_e8, 10_002_000_000n);
  assert.deepEqual(s.kind === 'tick' && s.sources, ['a', 'b', 'c']);
  const g = run(usdOnly, evs.slice(0, 2), 100);
  assert.deepEqual(g, { kind: 'gap', asset: 'SOL', ts: 100, reason: 'quorum', fresh: 2 });
});

test('stale: venue silent for > staleMs is dropped; a canary message keeps its last mid alive', () => {
  const base = [q('a', 'SOL', '100', '100', 0), q('b', 'SOL', '100', '100', 0), q('c', 'SOL', '100', '100', 0)];
  assert.equal(run(usdOnly, base, 1000).kind, 'tick');   // exactly staleMs old: still live
  assert.equal(run(usdOnly, base, 1100).kind, 'gap');
  // c's SOL book is quiet, but its BTC canary keeps the socket provably live -> SOL mid carries forward
  const canary = [...base, q('a', 'BTC', '1', '1', 900), q('b', 'BTC', '1', '1', 900), q('c', 'BTC', '1', '1', 900)];
  assert.equal(run(usdOnly, canary, 1800).kind, 'tick');
  // ...but not past maxQuoteAgeMs
  assert.equal(run(cfg({ ...usdOnly, maxQuoteAgeMs: 1500 }), canary, 1800).kind, 'gap');
});

test('down event drops the venue at once', () => {
  const evs: FeedEvent[] = [q('a', 'SOL', '100', '100', 0), q('b', 'SOL', '100', '100', 0), q('c', 'SOL', '100', '100', 0), { e: 'down', v: 'c', r: 50 }];
  assert.equal(run(usdOnly, evs, 100).kind, 'gap');
});

test('only events received strictly before t count', () => {
  const evs = [q('a', 'SOL', '100', '100', 0), q('b', 'SOL', '100', '100', 0), q('c', 'SOL', '100', '100', 100)];
  assert.equal(run(usdOnly, evs, 100).kind, 'gap');
  assert.equal(run(usdOnly, evs, 200).kind, 'tick');
});

test('outlier: > outlierBps from the first median is dropped; too few left is a gap', () => {
  const evs = [q('a', 'SOL', '100', '100', 0), q('b', 'SOL', '100.01', '100.01', 0), q('c', 'SOL', '100.02', '100.02', 0),
    q('d', 'SOL', '100.30', '100.30', 0)];   // d is ~29 bp off
  const s = run(usdOnly, evs, 100);
  assert.equal(s.kind === 'tick' && s.price_e8, 10_001_000_000n);
  assert.deepEqual(s.kind === 'tick' && s.sources, ['a', 'b', 'c']);
  // exactly 15 bp is kept (100 * 1.0015 = 100.15)
  const edge = run(usdOnly, [q('a', 'SOL', '100', '100', 0), q('b', 'SOL', '100', '100', 0), q('c', 'SOL', '100.15', '100.15', 0)], 100);
  assert.deepEqual(edge.kind === 'tick' && edge.sources, ['a', 'b', 'c']);
  const three = run(usdOnly, [q('a', 'SOL', '100', '100', 0), q('b', 'SOL', '100', '100', 0), q('c', 'SOL', '101', '101', 0)], 100);
  assert.deepEqual(three, { kind: 'gap', asset: 'SOL', ts: 100, reason: 'outliers', fresh: 2 });
});

test('crossed and wide books are dropped', () => {
  const ok = [q('a', 'SOL', '100', '100.01', 0), q('b', 'SOL', '100', '100.01', 0)];
  assert.equal(run(usdOnly, [...ok, q('c', 'SOL', '100.02', '100.01', 0)], 100).kind, 'gap');   // crossed
  assert.equal(run(usdOnly, [...ok, q('c', 'SOL', '100', '100.11', 0)], 100).kind, 'gap');      // 11 bp spread
  assert.equal(run(usdOnly, [...ok, q('c', 'SOL', '100', '100.10', 0)], 100).kind, 'tick');     // 10 bp, kept
  assert.equal(run(usdOnly, [...ok, q('c', 'SOL', '0', '0', 0)], 100).kind, 'gap');            // zero
});

test('USDT venues convert at the USD venues\' USDT/USD rate', () => {
  const usdt = [q('coinbase', 'USDT', '0.999', '0.999', 0), q('kraken', 'USDT', '0.999', '0.999', 0)];
  const evs = [...usdt, q('binance', 'SOL', '100', '100', 0), q('okx', 'SOL', '100', '100', 0), q('bybit', 'SOL', '100', '100', 0)];
  const s = run(cfg(), evs, 100);
  assert.equal(s.kind === 'tick' && s.price_e8, 9_990_000_000n);
  // no USDT/USD rate: USDT venues cannot be used
  assert.equal(run(cfg(), evs.slice(2), 100).kind, 'gap');
});

test('USDT rate is a window mean, and a depeg gaps every asset', () => {
  const idx = new HexitIndex(cfg({ assets: ['SOL', 'BTC'] }));
  idx.push(q('coinbase', 'USDT', '1', '1', 0));
  assert.equal(idx.sampleAt(100)[0].kind, 'gap');            // rate 1.00 but no SOL quotes
  idx.push(q('coinbase', 'USDT', '0.97', '0.97', 150));
  // window now holds 1.00 and 0.97 -> mean 0.985, still in band
  for (const v of ['binance', 'okx', 'bybit']) idx.push(q(v, 'SOL', '100', '100', 150));
  const s = idx.sampleAt(200)[0];
  assert.equal(s.kind === 'tick' && s.price_e8, 9_850_000_000n);
  // more 0.97 samples drag the mean below 0.98 -> depeg for every asset
  for (let t = 300; t <= 600; t += 100) idx.push(q('coinbase', 'USDT', '0.97', '0.97', t - 1));
  let out: Sample[] = [];
  for (let t = 300; t <= 600; t += 100) out = idx.sampleAt(t);
  assert.deepEqual(out.map((x) => x.kind === 'gap' && x.reason), ['usdt-depeg', 'usdt-depeg']);
});

test('each asset needs its own quorum: BTC ticks while MON (quoted by two venues) gaps', () => {
  const idx = new HexitIndex(cfg({ ...usdOnly, assets: ['BTC', 'MON'] }));
  for (const v of ['a', 'b', 'c']) idx.push(q(v, 'BTC', '82420.0', '82420.2', 0));
  for (const v of ['a', 'b']) idx.push(q(v, 'MON', '0.02434', '0.02436', 0));   // c never quotes MON (as Binance)
  const [btc, mon] = idx.sampleAt(100);
  assert.deepEqual(btc, { kind: 'tick', asset: 'BTC', ts: 100, price_e8: 8_242_010_000_000n, sources: ['a', 'b', 'c'] });
  assert.deepEqual(mon, { kind: 'gap', asset: 'MON', ts: 100, reason: 'quorum', fresh: 2 });
  idx.push(q('d', 'MON', '0.02435', '0.02435', 150));
  assert.deepEqual(idx.sampleAt(200).map((s) => (s.kind === 'tick' ? s.price_e8 : s.kind)), [8_242_010_000_000n, 2_435_000n]);
});

test('gate venue: spot.book_ticker updates parse to quotes; acks and pongs do not', () => {
  const g = VENUES.gate;
  assert.deepEqual(g.parse({ time: 1760050000, channel: 'spot.book_ticker', event: 'update',
    result: { t: 1760050000123, u: 9, s: 'MON_USDT', b: '0.02434', B: '1200', a: '0.02436', A: '800' } }), [['MON_USDT', '0.02434', '0.02436', 1760050000123]]);
  assert.deepEqual(g.parse({ time: 1760050000, channel: 'spot.book_ticker', event: 'subscribe', result: { status: 'success' } }), []);
  assert.deepEqual(g.parse({ time: 1760050000, channel: 'spot.pong', event: '', result: null }), []);
  assert.deepEqual(g.subs(['BTC_USDT', 'MON_USDT'])[0], { time: (g.subs([])[0] as any).time, channel: 'spot.book_ticker', event: 'subscribe', payload: ['BTC_USDT', 'MON_USDT'] });
  assert.deepEqual(venueSymbols(g, ['BTC', 'MON']).map(g.sym), ['BTC_USDT', 'MON_USDT']);
  assert.deepEqual(venueSymbols(VENUES.kraken, ['BTC', 'MON']).map(VENUES.kraken.sym), ['BTC/USD', 'MON/USD', 'USDT/USD']);   // + the USDT leg
});

test('defaults: BTC and MON on six exchanges plus Perpl; quorum 4 meets the floor (main.ts runs DEFAULTS without loadConfig)', () => {
  const c = loadConfig();
  assert.deepEqual([c.assets, c.venues.length, c.minVenues, c.maxSpreadBps, c.staleMs], [['BTC', 'MON'], 7, 4, 20, 2000]);
  assert.deepEqual(indexConfig(c).venues.filter((v) => ['gate', 'perpl'].includes(v.name)), [{ name: 'gate', quote: 'USDT' }, { name: 'perpl', quote: 'USD' }]);
  const dir = mkdtempSync(join(tmpdir(), 'hexit-feed-')), file = (o: object) => { const p = join(dir, 'c.json'); writeFileSync(p, JSON.stringify(o)); return p; };
  assert.throws(() => loadConfig(file({ minVenues: 3 })), /minVenues/);          // 3 of 7 venues: below ceil(7/2)
  assert.deepEqual(c.minVenuesFor, { MON: 3 });                                    // MON: 6 venues quote it
  assert.throws(() => loadConfig(file({ minVenuesFor: { MON: 2 } })), /minVenuesFor\.MON/);
  assert.throws(() => loadConfig(file({ assets: ['DOGE'] })), /unknown asset/);
  assert.deepEqual(loadConfig(file({ assets: ['MON'] })).assets, ['MON']);
  rmSync(dir, { recursive: true });
});

test('perpl: book from snapshot + updates, best bid/ask in dollars, re-sent on every block heartbeat', () => {
  const v = VENUES.perpl;
  assert.deepEqual(venueSymbols(v, ['BTC', 'MON']).map(v.sym), ['16', '64', 'USDT']);
  assert.deepEqual(v.subs(['16', '64', 'USDT']), [{ mt: 5, subs: ['heartbeat@10143', 'order-book@16', 'order-book@64'].map((stream) => ({ stream, subscribe: true })) }]);
  assert.deepEqual(v.parse({ mt: 15, sid: 7, bid: [{ p: 829199, s: 1, o: 1 }], ask: [{ p: 829200, s: 1, o: 1 }] }), []);   // sid not yet known
  v.parse({ mt: 6, subs: [{ stream: 'order-book@16', sid: 7 }, { stream: 'order-book@64', sid: 8 }] });
  assert.deepEqual(v.parse({ mt: 15, sid: 7, bid: [{ p: 829199, s: 1, o: 1 }, { p: 829190, s: 2, o: 1 }], ask: [{ p: 829200, s: 1, o: 2 }] }), [['16', '82919.9', '82920.0']]);
  assert.deepEqual(v.parse({ mt: 16, sid: 7, bid: [{ p: 829199, s: 0, o: 0 }], ask: [] }), [['16', '82919.0', '82920.0']]);   // best bid removed
  assert.deepEqual(v.parse({ mt: 15, sid: 8, bid: [{ p: 2462, s: 5, o: 1 }], ask: [{ p: 2463, s: 5, o: 1 }] }), [['64', '0.02462', '0.02463']]);
  assert.deepEqual(v.parse({ mt: 100, sn: 1, h: 2 }), [['16', '82919.0', '82920.0'], ['64', '0.02462', '0.02463']]);
});

test('per-asset quorum: MON ticks on 3 fresh venues while BTC still needs 4', () => {
  const ix = new HexitIndex(cfg({ assets: ['BTC', 'MON'], venues: ['a', 'b', 'c', 'd'].map((name) => ({ name, quote: 'USD' as const })), minVenues: 4, minVenuesFor: { MON: 3 } }));
  for (const v of ['a', 'b', 'c']) { ix.push({ e: 'q', v, s: 'BTC', b: '100', a: '100.01', r: 1 }); ix.push({ e: 'q', v, s: 'MON', b: '0.02', a: '0.02', r: 1 }); }
  const [btc, mon] = ix.sampleAt(100);
  assert.equal(btc.kind, 'gap');
  assert.equal(mon.kind, 'tick');
});

