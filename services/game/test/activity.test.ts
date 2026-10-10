// node --test: the activity feed builder (activity.ts): HexitGame logs as the indexer decodes them -> feed items
// (entry, a settle carrying several players' bets), the ring's chain order and dedupe, and the Postgres seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hex, type Log } from 'viem';
import { decodeGameLogs, hexitGameAbi } from '@hexit/monad';
import { ActivityRing, fromEvent, seedActivity, type Activity } from '../src/activity.ts';
import type { ActivityRow } from '../src/db.ts';
import type { GameEvent } from '../src/indexer.ts';

const GAME = '0xe1341560B697EC40c9fa2e1e6EF270bF6b59fE39' as Address;
const A = '0x81a0b0c0d0e0f0a1b1c1d1e1f1a2b2c2d2e20402', B = '0x0000000000000000000000000000000000000b0b';
const SYMBOLS = new Map([[1, 'BTC/USD'], [3, 'MON/USD']]);
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex;
const AT = new Date(1_790_000_000_000);

/** A raw HexitGame log, encoded from its ABI as the chain emits it. */
function raw(eventName: 'BetPlaced' | 'BetSettled' | 'HexTouched', args: Record<string, unknown>, hash: Hex, block: bigint, logIndex: number): Log {
  const ev = hexitGameAbi.find((x) => x.type === 'event' && x.name === eventName) as { inputs: readonly { name: string; type: string; indexed?: boolean }[] };
  const data = ev.inputs.filter((i) => !i.indexed);
  return { address: GAME, topics: encodeEventTopics({ abi: hexitGameAbi, eventName, args } as never) as never,
    data: encodeAbiParameters(data as never, data.map((i) => args[i.name]) as never), blockNumber: block, logIndex, transactionHash: hash,
    blockHash: tx(999), transactionIndex: 0, removed: false };
}
const items = (logs: Log[]) => decodeGameLogs(logs, GAME).map((e) => fromEvent(e, AT, SYMBOLS));
const placed = (player: string, asset: number, nonce: bigint, slot = 0) =>
  ({ player, asset, k: 358_000_002, j: 4_400, stake: 1_000_000n, mult: 250, nonce, slot });
const settled = (player: string, asset: number, slot: number, outcome: number, credited: bigint) =>
  ({ player, asset, k: 358_000_002, j: 4_400 + slot, stake: 1_000_000n, mult: 250, slot, outcome, credited });

test('activity: a BetPlaced log is an entry; other markets and other events are no item', () => {
  const [it, sol, touch] = items([raw('BetPlaced', placed(A, 1, 7n), tx(1), 100n, 3), raw('BetPlaced', placed(A, 0, 8n), tx(2), 100n, 4),
    raw('HexTouched', { asset: 1, k: 358_000_002, j: 4_400, tsMs: 1n }, tx(3), 100n, 5)]);
  const P = getAddress(A);
  assert.deepEqual(it, { id: `${tx(1)}:3`, kind: 'entry', tx: tx(1), block: 100, ts: AT.getTime(), player: P, handle: `${P.slice(0, 6)}…0402`,
    asset: 1, symbol: 'BTC/USD', k: 358_000_002, j: 4_400, stake: '1000000', mult: 250, outcome: null, credited: null, payout: null });
  assert.equal(sol, null, 'SOL (closed, not served) is no item');
  assert.equal(touch, null);
});

test('activity: one settle carrying several players is one item per BetSettled log; payout = credited for WIN/VOID, 0 for LOSS', () => {
  const s = items([raw('BetSettled', settled(A, 3, 0, 1, 2_500_000n), tx(9), 120n, 0), raw('BetSettled', settled(B, 3, 0, 2, 0n), tx(9), 120n, 1),
    raw('BetSettled', settled(B, 3, 1, 3, 1_000_000n), tx(9), 120n, 2)]) as Activity[];
  assert.deepEqual(s.map((x) => x.id), [0, 1, 2].map((i) => `${tx(9)}:${i}`));
  assert.ok(s.every((x) => x.kind === 'settle' && x.tx === tx(9) && x.symbol === 'MON/USD' && x.block === 120));
  assert.deepEqual(s.map((x) => [x.player, x.outcome, x.credited, x.payout]),
    [[getAddress(A), 1, '2500000', '2500000'], [getAddress(B), 2, '0', '0'], [getAddress(B), 3, '1000000', '1000000']]);
});

test('activity ring: chain order (block, log index), each id once, newest max kept, latest newest first', () => {
  const [e1, e2, s1, s2] = items([raw('BetPlaced', placed(A, 1, 1n), tx(1), 100n, 0), raw('BetPlaced', placed(B, 3, 1n), tx(2), 101n, 0),
    raw('BetSettled', settled(A, 1, 0, 2, 0n), tx(3), 110n, 0), raw('BetSettled', settled(B, 3, 0, 1, 2n), tx(3), 110n, 1)]) as Activity[];
  const r = new ActivityRing(3);
  assert.ok(r.add(s1)); assert.ok(r.add(e2)); assert.ok(r.add(s2));
  assert.equal(r.add({ ...s1 }), false, 'a replayed log (WS reconnect, seed/replay overlap) is not added twice');
  assert.deepEqual(r.items.map((x) => x.id), [e2, s1, s2].map((x) => x.id), 'inserted in chain order');
  assert.equal(r.add(e1), false, 'older than every item kept when full: dropped');
  assert.deepEqual(r.latest(2).map((x) => x.id), [s2.id, s1.id]);
  assert.deepEqual(r.latest(30, new Set([3])).map((x) => x.id), [s2.id, e2.id]);
  const big = new ActivityRing(3);
  for (const x of [e1, e2, s1, s2]) big.add(x);
  assert.deepEqual(big.items.map((x) => x.id), [e2, s1, s2].map((x) => x.id), 'the oldest leaves');
  assert.ok(big.add(e1) === false && !big.ids.has(e1.id));
});

test('activity seed: Postgres rows; one without a log index takes it from its receipt, an unreadable receipt leaves it out', async () => {
  const row = (o: Partial<ActivityRow>): ActivityRow => ({ kind: 'entry', owner: A, nonce: '5', slot: 0, asset: 1, k: 358_000_002, j: 4_400, stake: '1000000',
    mult: 250, outcome: null, credited: null, tx: tx(1), block: 100, log: 2, at: AT, ...o });
  const receipts: Record<Hex, Log[]> = {
    [tx(4)]: [raw('BetPlaced', placed(A, 1, 6n, 1), tx(4), 104n, 7)],
    [tx(5)]: [raw('BetSettled', settled(B, 3, 0, 2, 0n), tx(5), 105n, 0), raw('BetSettled', settled(A, 3, 1, 1, 3_000_000n), tx(5), 105n, 1)],
  };
  const fetched: Hex[] = [], logs: string[] = [];
  const receiptLogs = async (h: Hex): Promise<GameEvent[]> => { fetched.push(h); if (!receipts[h]) throw new Error('429'); return decodeGameLogs(receipts[h], GAME); };
  const r = new ActivityRing();
  const n = await seedActivity(r, [
    row({}),
    row({ nonce: '6', slot: 1, tx: tx(4), block: 104, log: null }),
    row({ kind: 'settle', slot: 1, asset: 3, j: 4_401, outcome: 1, credited: '3000000', tx: tx(5), block: null, log: null }),
    row({ nonce: '9', tx: tx(6), log: null }),   // its receipt fails: left out
    row({ asset: 0, tx: tx(7), log: 0 }),          // SOL: not served
  ], SYMBOLS, receiptLogs, (_c, m) => logs.push(m));
  assert.equal(n, 3);
  assert.deepEqual(fetched.sort(), [tx(4), tx(5), tx(6)], 'only rows without a log index read a receipt');
  assert.deepEqual(r.items.map((x) => [x.id, x.kind, x.block, x.payout]),
    [[`${tx(1)}:2`, 'entry', 100, null], [`${tx(4)}:7`, 'entry', 104, null], [`${tx(5)}:1`, 'settle', 105, '3000000']]);
  assert.equal(logs.length, 1);
  // the indexer's replay of the same logs after the seed adds nothing
  const again = items(receipts[tx(5)]).filter(Boolean) as Activity[];
  assert.deepEqual(again.map((x) => r.add(x)), [true, false], 'B\'s LOSS was not in the rows; A\'s WIN already was');
});
