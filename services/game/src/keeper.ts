// Keeper (DECISIONS.md): once column k's span has ended (t_hi(k) + 1 s) it settles every player with an open bet on k
// via settleColumn with the recorder-signed tape, in batches; once k is decided, later batches carry no tape. With no
// tape for k past voidAfterMs it calls voidColumn (refunds). Columns without open bets are never touched, so an idle
// game spends no MON. settleColumn/voidColumn are permissionless and idempotent: a bet never settles twice.
// A column is (asset, k), keyed colKey(asset, k). SOL (0) bets left from before the markets upgrade have no tape (SOL is
// not indexed any more): a decided column settles them without one, any other VOIDs once its window opens.
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { hexitGameAbi, settleColumnGas, tHi } from '@hexit/monad';
import { pickLimit, type Sender } from './sender.ts';
import { colOf, type Open } from './indexer.ts';

export type SignedTape = { asset: number; k: number; ts: bigint[]; px: bigint[]; sig: Hex };
/** col = colKey(asset, k). */
export type Action = { col: number; asset: number; k: number; kind: 'settle' | 'void'; tape: boolean; players: string[] };

export const SETTLE_DELAY_MS = 1000;   // after t_hi(k): the tape needs the first tick at or after t_hi
const TAPE_CUTOFF_MS = 3000;           // stop offering a tape this long before the contract's window closes (TooLate)
const VOID_MARGIN_MS = 2000;           // void this long after it opens (block time is whole seconds)
const DONE_MS = 30_000;                // a player just settled on k is skipped this long (the indexer is ~1 s behind)
const MAX_PLAYERS = 20;                // per transaction
const RETRY_MS = 2000;
const SIM_CAP = 1_500_000n;            // > a 20-player volatile settle (~1.03M); the RPC wants balance >= cap x maxFee (0.3 MON)
// A one-way tape costs far more (maxMoveE8 every tick: ~2.26M for 1 player, security review L1). A failed simulation
// halves the column's batch; a lone tape settle that still fails is simulated again under BIG_CAP (needs 0.5 MON).
const BIG_CAP = 2_500_000n;
/** voidColumn's simulation cap. Receipts on anvil: 55-67k for one bet; a forge estimate (all storage cold) gives 108k
 *  for one bet, about 6k per extra bet and 19k per extra player (32 bets of one player 287k, 20 players 461k). Under
 *  SIM_CAP a void needed 0.3 MON in the keeper just to simulate, so a keeper with less never refunded anything (security
 *  review L2); this asks 0.022 MON for one bet. A lone void that still runs out of gas retries under SIM_CAP. */
export const voidCap = (bets: number) => 80_000n + 30_000n * BigInt(bets);

/** What to send now, pure: for each column with open bets whose span has ended, the next batch of its players. Every
 *  map and set here is keyed by colKey(asset, k). */
export function select(s: { now: number; open: Open; tapes: ReadonlyMap<number, unknown>; decided: ReadonlySet<number>;
  hold: ReadonlyMap<number, number>; done: ReadonlyMap<string, number>; voidAfterMs: number; size?: ReadonlyMap<number, number> }): Action[] {
  const out: Action[] = [];
  for (const [col, m] of s.open) {
    const { asset, k } = colOf(col), end = tHi(k), a = { col, asset, k };
    if (s.now < end + SETTLE_DELAY_MS || (s.hold.get(col) ?? 0) > s.now) continue;
    const players = [...m.keys()].filter((p) => (s.done.get(`${col}:${p}`) ?? -Infinity) <= s.now - DONE_MS).slice(0, s.size?.get(col) ?? MAX_PLAYERS);
    if (!players.length) continue;
    if (s.decided.has(col)) out.push({ ...a, kind: 'settle', tape: false, players });
    else if (s.now <= end + s.voidAfterMs - TAPE_CUTOFF_MS) { if (s.tapes.has(col)) out.push({ ...a, kind: 'settle', tape: true, players }); }
    else if (s.now > end + s.voidAfterMs + VOID_MARGIN_MS) out.push({ ...a, kind: 'void', tape: false, players });
  }
  return out.sort((a, b) => a.k - b.k || a.asset - b.asset);
}

const plus10 = (g: bigint) => (g * 110n + 99n) / 100n;

export function startKeeper(o: { sender: Sender; open: Open; decided: Set<number>; tapes: ReadonlyMap<number, SignedTape>;
  voidAfterMs: number; log: (cls: string, msg: string) => void; reject: (key: string) => void }) {
  const hold = new Map<number, number>(), done = new Map<string, number>(), busy = new Set<number>();
  const size = new Map<number, number>(), big = new Set<number>();   // per column: batch after a failed simulation; lone tape settle needs BIG_CAP
  let at = 0;

  async function run(a: Action) {
    const t = a.tape ? o.tapes.get(a.col)! : null, players = a.players as Address[];
    const data = a.kind === 'void'
      ? encodeFunctionData({ abi: hexitGameAbi, functionName: 'voidColumn', args: [a.asset, a.k, players] })
      : encodeFunctionData({ abi: hexitGameAbi, functionName: 'settleColumn', args: [a.asset, a.k, t?.ts ?? [], t?.px ?? [], t?.sig ?? '0x', players] });
    const bets = players.reduce((n, p) => n + (o.open.get(a.col)?.get(p)?.size ?? 1), 0);
    const cap = a.kind === 'void' ? (big.has(a.col) ? SIM_CAP : voidCap(bets)) : big.has(a.col) ? BIG_CAP : SIM_CAP;
    const sim = await o.sender.simulate(data, cap);
    if (!sim.ok) {
      hold.set(a.col, Date.now() + RETRY_MS);
      if (!/^[A-Z][A-Za-z0-9]+$/.test(sim.error))   // no contract error name: out of gas (or the RPC); try smaller, then bigger
        if (players.length > 1) size.set(a.col, Math.ceil(players.length / 2)); else if (a.tape || a.kind === 'void') big.add(a.col);
      o.reject(`${a.kind}:${sim.error}`);
      return o.log('keeper-sim', `${a.kind} ${a.asset}/${a.k} (${players.length} players): ${sim.error}`);
    }
    // a tape settle: GAS.md's formula (typical, then volatile tape); anything GAS.md has no figure for: simulated + 10 %
    const n = players.length, gas = a.tape ? pickLimit(sim.gasUsed, [settleColumnGas(n), settleColumnGas(n, true)]) ?? plus10(sim.gasUsed) : plus10(sim.gasUsed);
    const r = await (await o.sender.submit(a.kind, data, gas, sim.accessList)).landed;
    if (r.receipt?.status !== 'success') return void hold.set(a.col, Date.now() + RETRY_MS);
    o.decided.add(a.col);
    if (a.tape) { size.delete(a.col); big.delete(a.col); }   // decided: the rest of the column carries no tape and is cheap
    for (const p of a.players) done.set(`${a.col}:${p}`, Date.now());
    o.log(`keeper-${a.kind}`, `column ${a.asset}/${a.k}: ${n} players, gas ${r.receipt.gasUsed}/${gas} (sim ${sim.gasUsed}) ${r.hash}`);
  }

  const timer = setInterval(() => {
    const now = (at = Date.now());
    for (const a of select({ now, open: o.open, tapes: o.tapes, decided: o.decided, hold, done, voidAfterMs: o.voidAfterMs, size })) {
      if (busy.has(a.col)) continue;
      busy.add(a.col);
      run(a).catch((e) => { hold.set(a.col, Date.now() + RETRY_MS); o.log('keeper-error', `${a.asset}/${a.k}: ${(e as Error).message}`.slice(0, 200)); })
        .finally(() => busy.delete(a.col));
    }
    for (const [key, t] of done) if (t < now - 2 * DONE_MS) done.delete(key);
    for (const [col, t] of hold) if (t < now) hold.delete(col);
    for (const col of o.decided) if (!o.open.has(col) && tHi(colOf(col).k) < now - 3_600_000) o.decided.delete(col);
    for (const col of [...size.keys(), ...big]) if (!o.open.has(col)) { size.delete(col); big.delete(col); }
  }, 500);

  return { at: () => at, stop: () => clearInterval(timer) };
}
