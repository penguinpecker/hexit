// node --test: Perpl testnet trades (sources.ts perplVenue, mt 17 snapshot / mt 18 update -> feed items via perplTrades),
// and the API's GET /perpl + the stream's 'perpl' event (newest 20 on connect as backfill, oldest first; ?asset= filter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { parseDeployment } from '@hexit/monad';
import { perplTrades, VENUES, type PerplTrade } from '../src/feed/sources.ts';
import { ActivityRing } from '../src/activity.ts';
import { startApi } from '../src/api.ts';
import { TickRing } from '../src/tape.ts';

const H = (n: number) => n.toString(16).padStart(64, '0');
/** A Perpl trade as the testnet socket sends it (2026-10-11): txid without 0x, l and tx left out when 0. */
const fill = (b: number, txid: string, p: number, s: number, sd: number, l?: number) =>
  ({ at: { b, t: 1_791_659_413_000 + b, tx: 1, txid, ...(l === undefined ? {} : { l }) }, p, s, sd });

test('perpl trades: snapshot + update via the listener; sid map, decimals per market, notional to the cent, bad fills dropped', () => {
  const v = VENUES.perpl, got: [PerplTrade[], boolean][] = [], f = (t: PerplTrade[], snap: boolean) => void got.push([t, snap]);
  perplTrades.add(f);
  assert.deepEqual(v.parse({ mt: 17, sid: 2000016, d: [fill(10, H(1), 829770, 416, 1)] }), []);   // sid not yet known
  assert.equal(got.length, 0);
  v.parse({ mt: 6, sn: 1, subs: [{ stream: 'trades@16', sid: 2000016, status: { code: 0 } }, { stream: 'trades@64', sid: 2000064 },
    { stream: 'trades@99', sid: 2000099 }] });
  assert.deepEqual(v.parse({ mt: 17, sid: 2000016, sn: 9, d: [
    fill(10, H(0xa1), 829770, 416, 1),                     // BTC: price dp 1, size dp 5
    fill(11, `0x${H(0xb2).toUpperCase()}`, 830000, 1, 2, 4),   // 0x and upper case taken, sent lower case; l kept
    fill(12, 'zz', 830000, 1, 1), fill(12, H(1).slice(1), 830000, 1, 1), fill(12, H(2), 830000, 1, 3), fill(12, H(3), 0, 1, 1),
  ] }), []);
  const btc = (b: number, tx: string, l: number, side: string, price: string, size: string, notional: string): PerplTrade =>
    ({ id: `0x${tx}:${l}`, kind: 'perpl', tx: `0x${tx}`, block: b, ts: 1_791_659_413_000 + b, asset: 1, symbol: 'BTC/USD',
      side: side as 'buy', price, size, notional });
  assert.deepEqual(got, [[[btc(10, H(0xa1), 0, 'buy', '82977.0', '0.00416', '345.18'),   // 345.18432
    btc(11, H(0xb2), 4, 'sell', '83000.0', '0.00001', '0.83')], true]]);
  v.parse({ mt: 18, sid: 2000064, d: [fill(13, H(0xc3), 2469, 665, 2), fill(14, H(0xc4), 2500, 5, 1)] });   // MON: price dp 5, size dp 0
  assert.deepEqual(got[1][0].map((t) => [t.asset, t.symbol, t.side, t.price, t.size, t.notional]),
    [[3, 'MON/USD', 'sell', '0.02469', '665', '16.42'], [3, 'MON/USD', 'buy', '0.02500', '5', '0.13']]);   // 16.41885 and 0.125, half up
  assert.equal(got[1][1], false, 'mt 18 is live');
  v.parse({ mt: 18, sid: 2000099, d: [fill(15, H(0xd5), 100, 1, 1)] });   // a market we do not serve
  v.parse({ mt: 18, sid: 2000064, d: 'nope' });
  assert.equal(got.length, 2);
  perplTrades.delete(f);
});

test('perpl API: GET /perpl newest first (default 20, max 50); the stream backfills the newest 20 oldest first, then live', async () => {
  const ring = new ActivityRing<PerplTrade>(50, (a, b) => a.block < b.block);
  const item = (n: number, asset: number): PerplTrade => ({ id: `0x${H(n)}:0`, kind: 'perpl', tx: `0x${H(n)}`, block: 100 + n, ts: n,
    asset, symbol: asset === 1 ? 'BTC/USD' : 'MON/USD', side: 'buy', price: '1.0', size: '1', notional: '1.00' });
  for (let n = 60; n >= 1; n--) ring.add(item(n, n % 2 ? 1 : 3));   // arrives newest first: still kept in chain order
  assert.equal(ring.add(item(30, 3)), false, 'an id once');
  assert.deepEqual([ring.items.length, ring.items[0].block, ring.items[49].block], [50, 111, 160]);
  const d = parseDeployment(JSON.parse(readFileSync(new URL('../../../deployment/monad.json', import.meta.url), 'utf8')));
  const market = (asset: number) => ({ asset, symbol: '', name: '', decimals: 1, rowE8: 1n, maxMoveE8: 1n, enabled: true, ring: new TickRing(), quotes: null });
  const api = startApi({ d, read: {} as never, relayer: {} as never, txs: new Map(), granted: () => new Set(), tapes: new Map(), decided: () => new Set(),
    markets: [market(1), market(3)], db: null, activity: new ActivityRing(), perpl: ring, health: () => ({}), log: () => {}, reject: () => {},
    port: 0, host: '127.0.0.1', origins: [] });
  await new Promise((r) => api.server.once('listening', r));
  const base = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`;
  try {
    const blocks = async (q: string) => ((await (await fetch(`${base}/perpl${q}`)).json()).items as PerplTrade[]).map((t) => t.block);
    assert.deepEqual(await blocks(''), Array.from({ length: 20 }, (_, i) => 160 - i));
    assert.equal((await blocks('?limit=99')).length, 50);
    assert.deepEqual(await blocks('?limit=0'), [160]);
    const ac = new AbortController(), res = await fetch(`${base}/stream?asset=3`, { signal: ac.signal }), rd = res.body!.getReader();
    let text = '';
    const dec = new TextDecoder(), more = async () => { const r = await rd.read(); if (r.done) throw new Error('stream ended'); text += dec.decode(r.value, { stream: true }); };
    const events = () => text.split('\n\n').filter((e) => e.startsWith('event: perpl\n')).map((e) => JSON.parse(e.slice(e.indexOf('data: ') + 6)));
    while (events().length < 20) await more();
    const back = events();
    assert.ok(back.every((e) => e.backfill === true && e.asset === 3));
    assert.deepEqual(back.map((e) => e.block), Array.from({ length: 20 }, (_, i) => 122 + 2 * i));   // MON's newest 20, oldest first
    api.broadcast(item(61, 1), 'perpl');   // BTC: not on this stream
    api.broadcast(item(62, 3), 'perpl');
    while (events().length < 21) await more();
    assert.deepEqual(events().slice(20).map((e) => [e.block, e.backfill]), [[162, undefined]]);
    ac.abort();
  } finally { api.stop(); }
});
