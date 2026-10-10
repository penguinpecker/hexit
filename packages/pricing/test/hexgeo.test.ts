import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { segHitsInt, hexCentreInt, hexHits, ColumnSim, HEX_R_S } from '../src/index.ts';

const vec = JSON.parse(readFileSync(new URL('../../../tests/vectors/hex_segments.json', import.meta.url), 'utf8'));
const B = BigInt;

test('segHitsInt reproduces every seg case in hex_segments.json', () => {
  assert.equal(vec.seg.length, 2413);
  let hits = 0;
  for (const c of vec.seg) {
    const h = segHitsInt(B(c.T0), B(c.P0), B(c.T1), B(c.P1), B(c.k), B(c.j), B(c.row));
    assert.equal(h, c.hit, c.name ?? JSON.stringify(c));
    hits += +h;
  }
  assert.equal(hits, 1371);
});

test('float hexHits (the solver test) agrees with the integer test except on float ties', () => {
  let diff = 0;
  for (const c of vec.seg) {
    const [tc, pc2] = hexCentreInt(B(c.k), B(c.j), B(c.row));
    const R = HEX_R_S * 1000, row = Number(c.row);
    const f = hexHits(Number(B(c.T0) - tc) / R, Number(2n * B(c.P0) - pc2) / row,
      Number(B(c.T1) - tc) / R, Number(2n * B(c.P1) - pc2) / row);
    diff += +(f !== c.hit);
  }
  assert.ok(diff <= 6, `${diff} float/int disagreements`);
});

test('geometry: odd columns shift up half a band; edges are touches', () => {
  assert.deepEqual(hexCentreInt(1n, 0n, 10n), [7500n, 20n]);
  assert.deepEqual(hexCentreInt(-1n, 0n, 10n), [-2500n, 20n]);     // parity of negative k
  assert.ok(segHitsInt(4500n, 9n, 4500n, 9n, 0n, 0n, 10n));        // slanted edge: dt 2000, dp2 = 2*9 - 10 = 8
  assert.ok(!segHitsInt(4501n, 9n, 4501n, 9n, 0n, 0n, 10n));
});

test('ColumnSim reproduces every settle.onchain outcome (HexitGame._applyTape)', () => {
  assert.equal(vec.settle.length, 40);
  const tally: Record<string, number> = {};
  for (const c of vec.settle) {
    const ticks: [bigint, bigint][] = c.ticks.map(([t, p]: [number, number]) => [B(t), B(p)]);
    const row = B(c.row), bJ0 = Number(ticks[0][1] / row) - 128;
    const col = new ColumnSim(B(c.k), row, bJ0, c.gap_ms);
    for (let i = 1; i < ticks.length; i++) col.apply(ticks[i - 1][0], ticks[i - 1][1], ticks[i][0], ticks[i][1]);
    const last = ticks[ticks.length - 1][0];
    for (const r of c.results) {
      assert.equal(col.outcome(r.j, last), r.onchain, `${c.name} j=${r.j}`);
      tally[r.onchain] = (tally[r.onchain] ?? 0) + 1;
    }
  }
  assert.deepEqual(tally, { LOSS: 178, VOID: 98, WIN: 64, PENDING: 20 });
});

test('ColumnSim: missing data refunds, never a house win', () => {
  const k = 358000000n, row = 5_000_000n, p = 12_000_000_000n;   // price far from band j0+3
  const t = (ms: number) => 5000n * k + B(ms);
  const tape = (from: number, to: number, skip?: [number, number]) => {
    const col = new ColumnSim(k, row, Number(p / row) - 128, 250);
    let prev: number | null = null;
    for (let ms = from; ms <= to; ms += 100) {
      if (skip && ms > skip[0] && ms < skip[1]) continue;
      if (prev !== null) col.apply(t(prev), p, t(ms), p);
      prev = ms;
    }
    return col;
  };
  const j = Number(p / row) + 3;
  assert.equal(tape(-1000, 6000).outcome(j, t(6000)), 'LOSS');             // full contiguous chain
  assert.equal(tape(-500, 6000).outcome(j, t(6000)), 'VOID');              // observation began inside the span
  assert.equal(tape(-1000, 6000, [1000, 1400]).outcome(j, t(6000)), 'VOID'); // 400 ms gap > 250
  assert.equal(tape(-1000, 6000, [1000, 1200]).outcome(j, t(6000)), 'LOSS'); // one missed tick: 200 ms segment, still a chain
  assert.equal(tape(-1000, 5000).outcome(j, t(5000)), 'PENDING');          // tape not past the right tip yet
  assert.equal(tape(-1000, 5000).outcome(j, t(5834 + 2000)), 'VOID');      // market moved on without this column
  assert.throws(() => tape(-1000, 6000).outcome(j + 300, t(6000)), RangeError);
  // a segment the column was never given (record_tick did not pass it): the chain breaks -> VOID
  const col = new ColumnSim(k, row, Number(p / row) - 128, 250);
  for (let ms = -1000; ms < 6000; ms += 100) if (ms !== 2000) col.apply(t(ms), p, t(ms + 100), p);
  assert.equal(col.outcome(j, t(6000)), 'VOID');
});
