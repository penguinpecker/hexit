import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTable, hexP, TableCache, mixtureP, multX100, round3Down, sigKey, keySig, MIX } from '../src/index.ts';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const YEAR = 31536000;
const SOL = 0.65 * 120.45 / Math.sqrt(YEAR) / 0.05;     // 0.27883 bands/sqrt(s), as hex_pricing.py main()
const ETH = 0.0464 * 2712.3 / Math.sqrt(YEAR) / 0.5;    // 0.04482

// research/pricing/hex_pricing.py Table(sig,'hex').P(d,tau): pure BM (kappa = 1), 8 phases, dx = sd/8.
// Values re-computed today with .venv/bin/python (HEX.md prints them to 5 figures).
const REF: [name: string, sig: number, d: number, tau: number, P: number][] = [
  ['SOL d=0 tau=7.6', SOL, 0, 7.6, 0.683866881867642],
  ['SOL d=3 tau=92.6', SOL, 3, 92.6, 0.14373999317705605],
  ['ETH d=1 tau=12.6', ETH, 1, 12.6, 0.006403204521988247],
  ['ETH d=0.25 tau=32.6', ETH, 0.25, 32.6, 0.8741290600158835],
];

test('reference P from hex_pricing.py within 0.5% (engine at the reference resolution nph=8, dxf=8)', () => {
  const tabs = new Map([[SOL, buildTable(SOL, 8, 8)], [ETH, buildTable(ETH, 8, 8)]]);
  for (const [name, sig, d, tau, P] of REF) {
    const p = hexP(tabs.get(sig)!, sig, d, tau);
    assert.ok(rel(p, P) <= 0.005, `${name}: ${p} vs ${P} (${(rel(p, P) * 100).toFixed(3)}%)`);
  }
});

test('reference P at the prototype resolution (nph=2, dxf=4, what the quoter ships)', () => {
  const tabs = new Map([[SOL, buildTable(SOL)], [ETH, buildTable(ETH)]]);
  for (const [name, sig, d, tau, P] of REF) {
    const p = hexP(tabs.get(sig)!, sig, d, tau);
    if (name.startsWith('ETH d=1 ')) {
      // Tail cell: the prototype grid gives 0.00645 (the "P~0.00645" quoted for it), 0.73% above the
      // Python solve 0.006403 and inside its MC 0.00649 +/- 0.00018. Pinned here, so a drift shows.
      assert.ok(rel(p, 0.00645) <= 0.005, `${name}: ${p} vs 0.00645`);
      assert.ok(rel(p, P) <= 0.01, `${name}: ${p} vs ${P}`);
    } else {
      assert.ok(rel(p, P) <= 0.005, `${name}: ${p} vs ${P} (${(rel(p, P) * 100).toFixed(3)}%)`);
    }
  }
});

test('prototype gate: pricing_prototype.json (810 cases from the prototype code) within 0.1%, multX100 exact', () => {
  const doc = JSON.parse(readFileSync(new URL('../../../tests/vectors/pricing_prototype.json', import.meta.url), 'utf8'));
  assert.deepEqual(doc.params.MIX, MIX);
  const cache = new TableCache();
  let worst = 0, nearStep = 0;
  for (const c of doc.cases) {
    assert.equal(sigKey(c.sigB), c.sigBucket);
    const p = mixtureP(cache, c.sigB, c.d, c.lead);
    worst = Math.max(worst, rel(p, c.P));
    assert.ok(rel(p, c.P) <= 1e-3, `sig ${c.sigB} d ${c.d} lead ${c.lead}: ${p} vs ${c.P}`);
    const m = multX100(p);
    if (m !== c.multX100) {
      // allowed only when (1-e)/P is within 0.1% of a rounding step boundary
      const raw = 0.92 / c.P, step = raw < 10 ? 0.01 : 0.1, frac = raw / step - Math.floor(raw / step);
      assert.ok(Math.abs(m - c.multX100) <= step * 100 && Math.min(frac, 1 - frac) * step <= 1e-3 * raw, `mult ${m} vs ${c.multX100}`);
      nearStep++;
    }
  }
  assert.equal(doc.cases.length, 810);
  console.log(`  prototype vectors: worst rel ${worst.toExponential(2)}, ${nearStep} near-step mult differences, ${cache.tables.size} tables`);
});

test('round3Down matches the prototype vectors', () => {
  const doc = JSON.parse(readFileSync(new URL('../../../tests/vectors/pricing_prototype.json', import.meta.url), 'utf8'));
  for (const r of doc.round) assert.equal(round3Down(r.raw), r.round3Down, `raw ${r.raw}`);
});

test('multX100: rounding down, cap 100x, nothing under 1.01x', () => {
  const P = (raw: number) => 0.92 / raw;                 // P giving (1 - e)/P = raw at edge 8%
  assert.equal(multX100(P(1.0)), 0);                     // 1.00x can only lose: not offered
  assert.equal(multX100(P(1.009)), 0);
  assert.equal(multX100(P(1.01)), 101);                  // smallest offer
  assert.equal(multX100(P(1.4399)), 143);                // rounds down, never up
  assert.equal(multX100(P(9.999)), 999);
  assert.equal(multX100(P(10)), 1000);
  assert.equal(multX100(P(10.09)), 1000);                // 0.1 steps from 10x
  assert.equal(multX100(P(99.99)), 9990);
  assert.equal(multX100(P(100)), 10000);                 // cap
  assert.equal(multX100(P(250)), 10000);
  assert.equal(multX100(0), 10000);                      // P = 0 -> cap, not Infinity
  assert.equal(multX100(1), 0);                          // certain touch -> not offered
  assert.equal(multX100(1.5), 0);
  assert.equal(multX100(Number.NaN), 0);                 // garbage in -> not offered
  assert.equal(multX100(0.5, 0.2), 160);                 // edge parameter
  for (let i = 0; i < 20000; i++) {                       // every output is a valid on-chain u16 and house-safe
    const p = Math.random() ** 3, m = multX100(p);
    assert.ok(m === 0 || (m >= 101 && m <= 10000 && Number.isInteger(m)), `P ${p} -> ${m}`);
    if (m > 0 && m < 10000) assert.ok((m / 100) * p <= 0.92 + 1e-12, `pays above 1-e: P ${p} m ${m}`);
  }
});

test('sigma buckets: 6% log grid, table built at the bucket sigma', () => {
  assert.equal(sigKey(1), 0);
  assert.ok(Math.abs(keySig(sigKey(0.2788)) / 0.2788 - 1) <= 0.03);
  const cache = new TableCache();
  assert.equal(cache.get(0.2788), cache.get(0.2789));     // memoised per bucket
  assert.equal(cache.get(0.2788).sig, keySig(sigKey(0.2788)));
});
