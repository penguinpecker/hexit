// The live activity feed:
// every BetPlaced (kind 'entry': the transaction that placed a bet) and BetSettled (kind 'settle': WIN payout, VOID
// refund, LOSS) of the served markets, from every player, as the app's right-corner feed shows them. Real chain events
// only: the indexer's logs up to its finality block, and after a restart the newest rows of the Postgres bets table.
// id = tx:logIndex, so a settle carrying several bets is one item per BetSettled log, and an item is never sent twice.
import { getAddress, type Hex } from 'viem';
import type { GameEvent } from './indexer.ts';
import type { ActivityRow } from './db.ts';

export type Activity = { id: string; kind: 'entry' | 'settle'; tx: Hex; block: number; ts: number; player: string; handle: string;
  asset: number; symbol: string; k: number; j: number; stake: string; mult: number; outcome: number | null; credited: string | null;
  payout: string | null };
type Fields = { kind: 'entry' | 'settle'; tx: Hex; log: number; block: number; ts: number; player: string; asset: number; k: number;
  j: number; stake: bigint | string; mult: number; outcome?: number | null; credited?: bigint | string | null };

/** symbols: the served markets (asset -> 'BTC/USD'); another market's bet (SOL, closed) is no item. */
export function activityOf(f: Fields, symbols: ReadonlyMap<number, string>): Activity | null {
  const symbol = symbols.get(f.asset), settle = f.kind === 'settle';
  if (!symbol) return null;
  const player = getAddress(f.player), credited = settle ? String(f.credited) : null;
  return { id: `${f.tx}:${f.log}`, kind: f.kind, tx: f.tx, block: f.block, ts: f.ts, player, handle: `${player.slice(0, 6)}…${player.slice(-4)}`,
    asset: f.asset, symbol, k: f.k, j: f.j, stake: String(f.stake), mult: f.mult, outcome: settle ? f.outcome! : null, credited,
    payout: settle ? (f.outcome === 2 ? '0' : credited) : null };
}

/** An indexed log (at: its block's time) as an item, or null for every other event. */
export function fromEvent(e: GameEvent, at: Date, symbols: ReadonlyMap<number, string>): Activity | null {
  if (e.eventName !== 'BetPlaced' && e.eventName !== 'BetSettled') return null;
  const a = e.args as { player: string; asset: number; k: number; j: number; stake: bigint; mult: number; outcome?: number; credited?: bigint };
  return activityOf({ kind: e.eventName === 'BetPlaced' ? 'entry' : 'settle', tx: e.transactionHash!, log: e.logIndex!, block: Number(e.blockNumber),
    ts: at.getTime(), player: a.player, asset: Number(a.asset), k: Number(a.k), j: a.j, stake: a.stake, mult: a.mult, outcome: a.outcome, credited: a.credited }, symbols);
}

const logOf = (a: Activity) => Number(a.id.slice(a.id.indexOf(':') + 1));
const before = (a: Activity, b: Activity) => a.block < b.block || (a.block === b.block && logOf(a) < logOf(b));

/** The newest `max` items in chain order (block, log index), each id once. add() is false for an id already kept or
 *  an item older than all `max` kept, so whoever broadcasts on true never sends one twice. */
export class ActivityRing {
  items: Activity[] = [];
  max: number;
  ids = new Set<string>();
  constructor(max = 200) { this.max = max; }
  add(a: Activity): boolean {
    if (this.ids.has(a.id)) return false;
    let i = this.items.length;
    while (i > 0 && before(a, this.items[i - 1])) i--;
    if (i === 0 && this.items.length >= this.max) return false;
    this.items.splice(i, 0, a);
    this.ids.add(a.id);
    if (this.items.length > this.max) this.ids.delete(this.items.shift()!.id);
    return true;
  }
  /** The newest n of these markets (all when only is null), newest first. */
  latest(n: number, only: ReadonlySet<number> | null = null): Activity[] {
    return (only ? this.items.filter((a) => only.has(a.asset)) : this.items).slice(-n).reverse();
  }
}

/** On start with Postgres: the newest rows of the bets table into the ring. A row indexed before the log index was kept
 *  takes it (and a settle's block) from its transaction's receipt; one whose receipt cannot be read is left out, never
 *  shown under a made-up id. ponytail: refetched on every start, not written back; such rows leave the newest 200 after
 *  ~100 new bets. */
export async function seedActivity(ring: ActivityRing, rows: ActivityRow[], symbols: ReadonlyMap<number, string>,
  receiptLogs: (tx: Hex) => Promise<GameEvent[]>, log: (cls: string, msg: string) => void) {
  const missing = new Map<Hex, GameEvent[] | null>();
  for (const r of rows) if (r.log === null) missing.set(r.tx, null);
  for (const tx of missing.keys()) missing.set(tx, await receiptLogs(tx).catch((e) => (log('activity-seed', `${tx}: ${(e as Error).message}`.slice(0, 160)), null)));
  let n = 0;
  for (const r of rows) {
    if (r.log === null) {
      const e = missing.get(r.tx)?.find((x) => {
        const a = x.args as { player?: string; nonce?: bigint; slot?: number; asset?: number; k?: number };
        return a.player?.toLowerCase() === r.owner && (r.kind === 'entry' ? x.eventName === 'BetPlaced' && String(a.nonce) === r.nonce
          : x.eventName === 'BetSettled' && a.slot === r.slot && a.asset === r.asset && a.k === r.k);
      });
      if (!e) continue;
      r.log = e.logIndex!; r.block = Number(e.blockNumber);
    }
    if (r.block === null) continue;
    const it = activityOf({ ...r, log: r.log, block: r.block, player: r.owner, ts: r.at.getTime() }, symbols);
    if (it && ring.add(it)) n++;
  }
  return n;
}
