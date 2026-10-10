import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstOpenColumn, quoteColumn, quoteBoard, TableCache, volInit, volStep, sigmaUsd, volHot,
  mixtureP, multX100, sigKey, BOARD_COLS, QUOTE_BANDS } from '../src/index.ts';

const tLo = (k: number) => 5000 * k - 834;

test('firstOpenColumn = the on-chain lock: t_lo(k) >= now + 5100 + margin', () => {
  for (const now of [1_790_000_000_000, 1_790_000_000_066, 1_790_000_001_234, 1_790_000_004_999]) {
    const k = firstOpenColumn(now);
    assert.ok(tLo(k) >= now + 5100 + 500, `k ${k} is locked at ${now}`);
    assert.ok(tLo(k - 1) < now + 5100 + 500, `k ${k - 1} should already be open at ${now}`);
  }
  const k = 358_000_002;                                      // boundary to the millisecond (T-LOCK mirror)
  assert.equal(firstOpenColumn(tLo(k) - 5600), k);
  assert.equal(firstOpenColumn(tLo(k) - 5599), k + 1);
  assert.equal(firstOpenColumn(tLo(k) - 5100, 0), k);
});

const SOL_ROW = 5_000_000n, PRICE = 12_045_000_000n;          // $120.45, band $0.05

test('quoteColumn: uint16[64] layout of a Quote\'s mults for bands qJ0..qJ0+63', () => {
  const cache = new TableCache(), now = 1_790_000_000_000, k = firstOpenColumn(now), sig = 0.2788;
  for (const kk of [k, k + 1]) {                              // even and odd parity
    const q = quoteColumn({ k: kk, nowMs: now, priceE8: PRICE, rowE8: SOL_ROW, sigBands: sig, cache });
    assert.ok(q.mults instanceof Uint16Array && q.mults.length === QUOTE_BANDS);
    assert.equal(q.qJ0, 2409 - 32);                            // floor(120.45 / 0.05) - 32
    assert.equal(q.sigBucket, sigKey(sig));
    for (const m of q.mults) assert.ok(m === 0 || (m >= 101 && m <= 10000));
    // cell i is band qJ0+i: pc = (j + 0.5 + 0.5*(k&1))*row, lead to the left tip
    const lead = (5000 * kk - 2500 / 3 - now) / 1000;
    for (const i of [0, 20, 31, 32, 45, 63]) {
      const d = (q.qJ0 + i + 0.5 + 0.5 * (kk % 2)) - 2409;     // price sits exactly on band 2409's lower edge
      assert.equal(q.mults[i], multX100(mixtureP(cache, sig, d, lead)), `k ${kk} i ${i}`);
    }
    // the hex nearest the price is the cheapest, far bands hit the cap
    const near = q.mults[kk % 2 ? 31 : 32];
    assert.ok(near > 0 && near < 300 && q.mults[0] === 10000 && q.mults[63] === 10000, `near ${near}`);
  }
  const c = quoteColumn({ k, nowMs: now, priceE8: PRICE, rowE8: SOL_ROW, sigBands: sig, cache, centreBand: 2400 });
  assert.equal(c.qJ0, 2368);                                   // open_column's q_j0 = b_j0 + 96 = floor(p/row) - 32
});

test('vol state: EWMA ports, floor at 0.8 x base, hot tape pulls the nearest column', () => {
  let v = volInit(120.45, 0.65);
  assert.ok(Math.abs(sigmaUsd(v) - 0.0139417) < 1e-6);
  for (let i = 0; i < 6000; i++) v = volStep(v, 0);            // 10 min dead tape: never quote below the floor
  assert.equal(sigmaUsd(v), 0.8 * v.sigBase);
  let h = volInit(120.45, 0.65);
  for (let i = 0; i < 30; i++) h = volStep(h, 0.03);           // 3 s of fast moves
  assert.ok(volHot(h));
  const cache = new TableCache(), now = 1_790_000_000_000;
  const calm = quoteBoard({ nowMs: now, priceE8: PRICE, rowE8: SOL_ROW, vol: volInit(120.45, 0.65), cache });
  const hot = quoteBoard({ nowMs: now, priceE8: PRICE, rowE8: SOL_ROW, vol: h, cache });
  assert.equal(calm.length, BOARD_COLS);
  assert.equal(calm[0].k, firstOpenColumn(now));
  assert.equal(hot[0].k, firstOpenColumn(now) + 1);
  assert.deepEqual(calm.map(c => c.k), Array.from({ length: 18 }, (_, i) => calm[0].k + i));
});

test('benchmark: full 18-column board (18 x 64 cells x 3 mixture tables)', () => {
  const vol = volInit(120.45, 0.65), now = 1_790_000_000_000;
  const cache = new TableCache();
  let t = performance.now();
  quoteBoard({ nowMs: now, priceE8: PRICE, rowE8: SOL_ROW, vol, cache });
  const cold = performance.now() - t;
  const N = 20;
  t = performance.now();
  for (let i = 0; i < N; i++) quoteBoard({ nowMs: now + 250 * i, priceE8: PRICE + BigInt(i) * 100_000n, rowE8: SOL_ROW, vol, cache });
  const warm = (performance.now() - t) / N;
  console.log(`  board: cold ${cold.toFixed(0)} ms (builds ${cache.tables.size} tables), warm ${warm.toFixed(1)} ms per refresh`);
  assert.ok(warm < 250, `warm board ${warm} ms exceeds the 250 ms quoter refresh`);
});
