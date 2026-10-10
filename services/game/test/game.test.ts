// node --test: the tape builder, the keeper's settle selection, the relayer nonce manager, the playerOf bet decoder, the
// relayer's landing-time check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tHi, tLo } from '@hexit/monad';
import { TickRing, tapeFor, type Tick } from '../src/tape.ts';
import { select } from '../src/keeper.ts';
import { Nonces, pickLimit } from '../src/sender.ts';
import { lateCheck, openBets } from '../src/api.ts';
import { colKey, colOf, type Open } from '../src/indexer.ts';

const K = 358_000_002;   // even column; tLo = 1790000009166, tHi = 1790000015834
const grid = (from: number, to: number, skip: (ts: number) => boolean = () => false): Tick[] => {
  const out: Tick[] = [];
  for (let ts = Math.ceil(from / 100) * 100; ts <= to; ts += 100) if (!skip(ts)) out.push({ ts, px: 12_000_000_000n + BigInt(ts % 700) * 1000n });
  return out;
};

test('tape: from the last tick at or before t_lo through the first at or after t_hi', () => {
  const ticks = grid(tLo(K) - 1000, tHi(K) + 1000), t = tapeFor(ticks, K)!;
  assert.equal(t[0].ts, 1790000009100);                      // last tick <= tLo (9166)
  assert.equal(t.at(-1)!.ts, 1790000015900);                 // first tick >= tHi (15834)
  assert.ok(t[0].ts <= tLo(K) && t[1].ts > tLo(K) && t.at(-1)!.ts >= tHi(K) && t.at(-2)!.ts < tHi(K));
  assert.equal(t.length, 69);
  // not before a tick at or after t_hi exists
  assert.equal(tapeFor(grid(tLo(K) - 1000, tHi(K) - 1), K), null);
  // the ring starts inside the span: nobody can settle k from it (it VOIDs)
  assert.equal(tapeFor(grid(tLo(K) + 1, tHi(K) + 1000), K), null);
  // a hole inside stays a hole (the contract turns it into a gap); a hole at t_hi ends the tape at the next tick
  const holed = tapeFor(grid(tLo(K) - 1000, tHi(K) + 1000, (ts) => (ts > 1790000012000 && ts < 1790000013000) || (ts > 1790000015700 && ts < 1790000016300)), K)!;
  assert.equal(holed.length, 69 - 9 - 1);
  assert.equal(holed.at(-1)!.ts, 1790000016300);
  // exact boundaries count: a tick exactly on t_lo / t_hi (grid ticks are multiples of 100, so shift the column math)
  const exact = [{ ts: tLo(K), px: 1n }, { ts: tLo(K) + 100, px: 1n }, { ts: tHi(K), px: 1n }, { ts: tHi(K) + 100, px: 1n }];
  assert.deepEqual(tapeFor(exact, K)!.map((x) => x.ts), [tLo(K), tLo(K) + 100, tHi(K)]);
});

test('tick ring: strictly increasing, refuses a move over maxMoveE8 per 100 ms, heals with time', () => {
  const r = new TickRing(300_000, 25_000_000n);
  assert.ok(r.push({ ts: 1000, px: 10_000_000_000n }));
  assert.ok(!r.push({ ts: 1000, px: 10_000_000_000n }));                // not newer
  assert.ok(!r.push({ ts: 1100, px: 10_025_000_001n }));                // 5 bands + 1 in 100 ms
  assert.ok(r.push({ ts: 1200, px: 10_025_000_001n }));                 // allowance doubled after 200 ms
  assert.ok(r.push({ ts: 1300, px: 10_000_000_001n }));                 // exactly at the limit
  assert.deepEqual(r.since(1200).map((t) => t.ts), [1200, 1300]);
  for (let ts = 1400; ts < 400_000; ts += 100) r.push({ ts, px: 10_000_000_001n });
  assert.ok(r.ticks[0].ts >= r.last()!.ts - 300_000 - 10_000);          // trimmed to ~5 min
});

test('keeper: settles only ended columns with open bets; void after voidAfterMs without a tape', () => {
  const end = tHi(K), voidAfterMs = 120_000, B = colKey(1, K), B1 = colKey(1, K + 1);   // BTC columns K and K + 1
  const open: Open = new Map([[B, new Map([['0xa', new Set([0])], ['0xb', new Set([1, 2])]])], [B1, new Map([['0xa', new Set([3])]])]]);
  const tapes = new Map([[B, 1], [B1, 1]]), none = new Map(), base = { open, tapes, decided: new Set<number>(), hold: none, done: none, voidAfterMs };
  const act = (kind: string, tape: boolean, players: string[], asset = 1, k = K) => ({ col: colKey(asset, k), asset, k, kind, tape, players });
  assert.deepEqual(select({ ...base, now: end + 999 }), []);                                  // span not over (+1 s)
  assert.deepEqual(select({ ...base, now: end + 1000 }), [act('settle', true, ['0xa', '0xb'])]);
  assert.deepEqual(select({ ...base, now: end + 1000, decided: new Set([B]) }), [act('settle', false, ['0xa', '0xb'])]);
  assert.deepEqual(select({ ...base, now: end + 1000, hold: new Map([[B, end + 1001]]) }), []);
  assert.deepEqual(select({ ...base, now: end + 1000, done: new Map([[`${B}:0xa`, end]]) }).map((a) => a.players), [['0xb']]);
  assert.deepEqual(select({ ...base, now: end + 31_000, done: new Map([[`${B}:0xa`, end]]) }).map((a) => [a.k, a.players]), [[K, ['0xa', '0xb']], [K + 1, ['0xa']]]);
  // no tape: wait, then void once the contract allows it; a tape that comes too late is not used
  const noTape = { ...base, tapes: new Map() };
  assert.deepEqual(select({ ...noTape, now: end + 60_000 }), []);
  assert.deepEqual(select({ ...base, now: end + voidAfterMs - 2000 }).map((a) => a.k), [K + 1]);   // K's tape window is closing: neither
  assert.deepEqual(select({ ...noTape, now: end + voidAfterMs + 2000 }), []);
  assert.deepEqual(select({ ...noTape, now: end + voidAfterMs + 2001 }), [act('void', false, ['0xa', '0xb'])]);
  // empty columns are never touched; big columns go 20 players per transaction
  assert.deepEqual(select({ ...base, open: new Map(), now: end + 5000 }), []);
  const crowd: Open = new Map([[B, new Map(Array.from({ length: 45 }, (_, i) => [`0x${i}`, new Set([0])]))]]);
  assert.equal(select({ ...base, open: crowd, now: end + 5000 })[0].players.length, 20);
  // after a failed simulation the column's batch is smaller
  assert.equal(select({ ...base, open: crowd, now: end + 5000, size: new Map([[B, 5]]) })[0].players.length, 5);
});

test('keeper: the same k on several markets is several columns, each with its own tape, decision and players', () => {
  const end = tHi(K), voidAfterMs = 120_000, [S, B, M] = [0, 1, 3].map((a) => colKey(a, K));
  assert.deepEqual([colOf(M), colOf(colKey(255, 2 ** 32 - 1))], [{ asset: 3, k: K }, { asset: 255, k: 2 ** 32 - 1 }]);
  assert.notEqual(colKey(1, K), colKey(3, K));
  const open: Open = new Map([[S, new Map([['0xs', new Set([0])]])], [B, new Map([['0xa', new Set([1])]])], [M, new Map([['0xa', new Set([2])], ['0xb', new Set([0])]])]]);
  const none = new Map(), base = { open, decided: new Set<number>(), hold: none, done: none, voidAfterMs };
  const pick = (x: ReturnType<typeof select>) => x.map((a) => [a.asset, a.k, a.kind, a.tape, a.players]);
  // only BTC's tape exists yet: BTC settles, MON waits; the SOL bet (no tape, SOL is not indexed any more) waits
  assert.deepEqual(pick(select({ ...base, tapes: new Map([[B, 1]]), now: end + 1000 })), [[1, K, 'settle', true, ['0xa']]]);
  // MON decided on chain (by anyone): its players settle without a tape; BTC's tape and MON's are not interchangeable
  assert.deepEqual(pick(select({ ...base, tapes: new Map([[B, 1]]), decided: new Set([M]), now: end + 1000 })),
    [[1, K, 'settle', true, ['0xa']], [3, K, 'settle', false, ['0xa', '0xb']]]);
  // a player done on BTC K is not done on MON K
  assert.deepEqual(pick(select({ ...base, tapes: new Map([[B, 1], [M, 1]]), done: new Map([[`${B}:0xa`, end]]), now: end + 1000 })),
    [[3, K, 'settle', true, ['0xa', '0xb']]]);
  // past the void window: the SOL-era bet is refunded by voidColumn(0, K), the others too if still without a tape
  assert.deepEqual(pick(select({ ...base, tapes: new Map(), now: end + voidAfterMs + 2001 })),
    [[0, K, 'void', false, ['0xs']], [1, K, 'void', false, ['0xa']], [3, K, 'void', false, ['0xa', '0xb']]]);
});

test('relayer: the contract time checks at the latest second a bet sent now may land in (now + 600 ms)', () => {
  const k = K, lead = tLo(k) - 6100;                           // the last ms the lock allows a bet (5100 + 1000 margin)
  const q = (ref: number) => ({ refTsMs: BigInt(ref), expiresMs: BigInt(ref + 1500) }), b = { k, deadline: BigInt(Math.floor(lead / 1000) + 10) };
  const at = (now: number, ref = now - 200, bb = b) => lateCheck(now, bb, q(ref), 1500, 1000);
  const s0 = Math.floor(lead / 1000) * 1000 - 5000;            // a whole second, well before the lock
  assert.equal(at(s0 + 399), null);
  // quote age: at +399 ms the bet lands in this second at the latest; at +400 it may land in the next one
  assert.equal(at(s0 + 399, s0 - 1500), null);                 // refTs + 1500 = this second's start: still good
  assert.equal(at(s0 + 400, s0 - 1500), 'QuoteStale');         // would land in the next second, where it is stale
  assert.equal(at(s0 + 400, s0 - 500), null);
  assert.equal(at(s0 + 400, s0, { k, deadline: BigInt(s0 / 1000) }), 'Expired');
  assert.equal(at(s0 + 399, s0, { k, deadline: BigInt(s0 / 1000) }), null);
  // the lock, with the landing second as "now" (the chain's whole-second clock)
  const L = Math.floor(lead / 1000) * 1000;                    // the latest second the lock still allows
  assert.equal(at(L - 601, L - 800), null);                    // lands in second L - 1000 at the latest
  assert.equal(at(L + 399, L - 200), null);
  assert.equal(at(L + 400, L - 200), 'Locked');                // may land in second L + 1000: past the lock
  assert.equal(lateCheck(L - 2000, b, q(lead + 1), 1500, 1000), 'Locked');   // a quote from after the lock time
});

test('nonces: consecutive from the chain count, a released one is reused first, resync re-reads', async () => {
  let chain = 7, reads = 0;
  const n = new Nonces(async () => { reads++; await new Promise((r) => setTimeout(r, 5)); return chain; });
  assert.deepEqual(await Promise.all([n.take(), n.take(), n.take()]), [7, 8, 9]);
  assert.equal(reads, 1);                       // concurrent first takes share one read
  n.release(8);                                 // never reached the chain
  n.release(8); n.release(42);                  // duplicates and never-issued nonces are ignored
  assert.equal(await n.take(), 8);
  assert.equal(await n.take(), 10);
  chain = 20; n.resync();                       // e.g. "nonce too low"
  assert.equal(await n.take(), 20);
  assert.equal(reads, 2);
  // gas: the tightest GAS.md limit with 5 % to spare, else none
  assert.equal(pickLimit(99_000n, [104_464n, 137_038n]), 104_464n);
  assert.equal(pickLimit(100_000n, [104_464n, 137_038n]), 137_038n);
  assert.equal(pickLimit(140_000n, [104_464n, 137_038n]), null);
});

test('playerOf bets: open slots decoded from the packed words, with the market at bit 112', () => {
  const rec = (k: number, j: number, stake: number, mult: number, asset = 0) =>
    BigInt(k) | (BigInt.asUintN(32, BigInt(j)) << 32n) | (BigInt(stake) << 64n) | (BigInt(mult) << 96n) | (BigInt(asset) << 112n);
  const words = Array(16).fill(1n);
  words[0] = rec(K, -7, 1_000_000, 150, 1) | (rec(K + 1, 5, 2_000_000, 10_000, 3) << 128n);
  words[5] = rec(K + 2, 0, 100_000, 101) << 128n;   // slot 11, a pre-markets record: asset bits 0 (SOL)
  words[7] = rec(K + 3, -1, 100_000, 65_535, 255) | (1n << 127n);   // slot 14: every field at its widest, plus a stray high bit
  assert.deepEqual(openBets(0b0100_1000_0000_0011, words), [
    { slot: 0, asset: 1, k: K, j: -7, stake: '1000000', mult: 150 }, { slot: 1, asset: 3, k: K + 1, j: 5, stake: '2000000', mult: 10_000 },
    { slot: 11, asset: 0, k: K + 2, j: 0, stake: '100000', mult: 101 }, { slot: 14, asset: 255, k: K + 3, j: -1, stake: '100000', mult: 65_535 }]);
  assert.deepEqual(openBets(0b10, words).map((b) => b.slot), [1]);
});
