// Indexer (SPEC-MONAD §5.2 indexer.ts, §6): HexitGame events by block range from a cursor, up to the `finality` block
// (finalized on testnet, ~0.6 s behind Proposed). Each range goes to memory first (open bets for the keeper, granted
// owners for the leaderboard, live events for /stream), then to Postgres in one transaction with the cursor, so a
// restart resumes exactly where the database stopped. A WS log subscription only wakes the loop early; getLogs is the
// source of truth, so a dropped subscription loses nothing. Never eth_newFilter (Monad does not support it).
// Columns are per market, (asset, k); events from before the markets upgrade decode as asset 0 (decodeGameLogs).
import { createPublicClient, webSocket, type Address, type Client, type Hex } from 'viem';
import { getBlock, getLogs, watchEvent } from 'viem/actions';
import { decodeGameLogs } from '@hexit/monad';
import { loadState, writeRange, type Db, type Table } from './db.ts';

export type GameEvent = ReturnType<typeof decodeGameLogs>[number];
/** colKey(asset, k) -> player (lowercase) -> open bet slots. */
export type Open = Map<number, Map<string, Set<number>>>;

/** Column (asset, k) as one number: asset · 2³² + k (exact in a double; the contract's own key is k | asset << 32). */
export const colKey = (asset: number, k: number) => asset * 2 ** 32 + k;
export const colOf = (key: number) => ({ asset: Math.floor(key / 2 ** 32), k: key % 2 ** 32 });

export function startIndexer(o: { read: Client; ws: string | null; game: Address; deployBlock: bigint;
  finality: 'latest' | 'safe' | 'finalized'; window: bigint; db: Db | null; log: (cls: string, msg: string) => void;
  /** every event once, in chain order; live = after the head seen at start (history replays are not live) */
  onEvent: (e: GameEvent, at: Date, live: boolean) => void }) {
  const { read, game, db, log } = o, cursor = `game:${game.toLowerCase()}`;
  const open: Open = new Map(), granted = new Set<string>(), decided = new Set<number>();
  let mem = o.deployBlock - 1n, dbAt: bigint | null = mem, liveFrom: bigint | null = null, head = 0n;
  const times = new Map<bigint, number>();

  const setOpen = (col: number, who: string, slot: number, on: boolean) => {
    let m = open.get(col);
    if (on) { if (!m) open.set(col, (m = new Map())); (m.get(who) ?? m.set(who, new Set()).get(who)!).add(slot); return; }
    m?.get(who)?.delete(slot);
    if (m?.get(who)?.size === 0) m.delete(who);
    if (m?.size === 0) open.delete(col);
  };

  async function fetchRange(from: bigint, to: bigint) {
    const logs = decodeGameLogs(await getLogs(read, { address: game, fromBlock: from, toBlock: to }), game);
    const out: { e: GameEvent; at: Date }[] = [];
    for (const e of logs) {
      const n = e.blockNumber!;
      let ts = e.blockTimestamp != null ? Number(e.blockTimestamp) : times.get(n);
      if (ts === undefined) { ts = Number((await getBlock(read, { blockNumber: n })).timestamp); times.set(n, ts); }
      out.push({ e, at: new Date(ts * 1000) });
    }
    if (times.size > 1000) times.clear();
    return out;
  }

  /** Postgres rows for one range (SPEC-MONAD §6); addresses lowercase. */
  function rowsOf(evs: { e: GameEvent; at: Date }[]) {
    const rows: Partial<Record<Table, unknown[][]>> = { bets: [], players: [], transfers: [], touches: [] }, settles: unknown[][] = [];
    for (const { e, at } of evs) {
      const h = e.transactionHash, a = e.args as Record<string, unknown>, who = typeof a.player === 'string' ? a.player.toLowerCase() : '';
      switch (e.eventName) {
        case 'BetPlaced': rows.bets!.push([who, String(a.nonce), a.asset, String(a.k), a.j, String(a.stake), a.mult, a.slot, String(e.blockNumber), h, at, e.logIndex]);
          rows.players!.push([who, at, null, null, null, at]); break;
        case 'BetSettled': settles.push([who, a.slot, a.asset, String(a.k), a.outcome, String(a.credited), h, at, String(e.blockNumber), e.logIndex]); break;
        case 'HexTouched': rows.touches!.push([a.asset, String(a.k), a.j, String(a.tsMs), h]); break;
        case 'Granted': rows.transfers!.push([who, 'grant', String(a.amount), h, at]); rows.players!.push([who, at, at, h, h, null]); break;
        case 'Deposited': rows.transfers!.push([who, 'deposit', String(a.amount), h, at]); break;
        case 'Withdrawn': rows.transfers!.push([who, 'withdraw', String(a.amount), h, at]); break;
      }
    }
    return { rows, settles };
  }

  function apply({ e, at }: { e: GameEvent; at: Date }) {
    const a = e.args as Record<string, unknown>, who = typeof a.player === 'string' ? a.player.toLowerCase() : '';
    const col = colKey(Number(a.asset ?? 0), Number(a.k ?? 0));
    if (e.eventName === 'BetPlaced') setOpen(col, who, Number(a.slot), true);
    else if (e.eventName === 'BetSettled') setOpen(col, who, Number(a.slot), false);
    else if (e.eventName === 'ColumnSettled' || e.eventName === 'ColumnVoided') decided.add(col);
    else if (e.eventName === 'Granted') granted.add(who);
    o.onEvent(e, at, liveFrom !== null && e.blockNumber! > liveFrom);
  }

  async function headBlock() {
    return o.finality === 'latest' ? (await getBlock(read)).number : (await getBlock(read, { blockTag: o.finality })).number;
  }

  /** Postgres behind memory (it was down): one window per pass, refetched. */
  async function dbCatchUp() {
    if (!db || dbAt === mem) return;
    if (dbAt === null) dbAt = (await loadState(db, cursor)).block ?? o.deployBlock - 1n;
    const to = mem < dbAt + o.window ? mem : dbAt + o.window;
    if (to <= dbAt) return;
    const { rows, settles } = rowsOf(await fetchRange(dbAt + 1n, to));
    await writeRange(db, cursor, to, rows, settles);
    dbAt = to;
  }

  let running: Promise<void> | null = null, again = false;
  async function pass() {
    head = await headBlock();
    liveFrom ??= head;
    while (mem < head) {
      const to = head < mem + o.window ? head : mem + o.window, evs = await fetchRange(mem + 1n, to);
      for (const ev of evs) apply(ev);
      if (db && dbAt === mem) {
        const { rows, settles } = rowsOf(evs);
        await writeRange(db, cursor, to, rows, settles).then(() => { dbAt = to; }, (e) => log('db-error', `indexer: ${(e as Error).message}`));
      }
      mem = to;
    }
    await dbCatchUp().catch((e) => log('db-error', `indexer catch-up: ${(e as Error).message}`));
  }
  const kick = () => {
    if (running) { again = true; return; }
    running = pass().catch((e) => log('indexer-error', String((e as Error).message ?? e).slice(0, 200)))
      .finally(() => { running = null; if (again) { again = false; kick(); } });
  };

  let timer: NodeJS.Timeout | undefined, unwatch = () => {};
  const ready = (async () => {
    if (db) {
      try {
        const s = await loadState(db, cursor);
        mem = dbAt = s.block ?? o.deployBlock - 1n;
        for (const b of s.open) setOpen(colKey(b.asset, b.k), b.owner, b.slot, true);
        for (const g of s.granted) granted.add(g);
      } catch (e) { dbAt = null; log('db-error', `indexer state: ${(e as Error).message}; replaying from the deploy block`); }
    }
    // caught up once before `ready`, so the keeper never re-settles bets that settled while this process was down
    kick();
    await running;
    timer = setInterval(kick, 2000);
    // the subscription is only a wake-up call: give the block ~0.7 s to reach `finality`, then read it with getLogs
    if (!o.ws) return;
    const wsc = createPublicClient({ transport: webSocket(o.ws, { reconnect: true, keepAlive: true }) });
    unwatch = watchEvent(wsc, { address: game, onLogs: () => void setTimeout(kick, o.finality === 'latest' ? 0 : 700),
      onError: (e) => log('indexer-ws', String(e.message).slice(0, 160)) });
  })();

  return {
    open, granted, decided, ready,
    status: () => ({ indexedBlock: Number(mem), dbBlock: dbAt === null ? null : Number(dbAt), headBlock: Number(head) }),
    stop: () => { clearInterval(timer); unwatch(); },
  };
}
export type Indexer = ReturnType<typeof startIndexer>;
