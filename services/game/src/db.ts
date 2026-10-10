// Postgres (DATABASE_URL; Railway Postgres in project hexit-monad; SPEC-MONAD §6): bets, players, transfers,
// faucet grants, the backfill cursor, the tick tape and hex touches (7 days),
// service transactions and per-minute service stats. Optional: without DATABASE_URL the services run without records.
// Addresses are stored lowercase 0x hex. Every wait is bounded (connect 3 s, query 3 s). Bets, ticks and touches carry
// the market (asset: SOL 0, BTC 1, MON 3); rows from before the markets upgrade are asset 0.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Hex } from 'viem';

export type Db = pg.Pool;

const SCHEMA = `
create table if not exists bets (owner text not null, nonce bigint not null, asset smallint not null default 0, k bigint not null,
  j int not null, stake bigint not null, mult int not null, slot smallint not null, placed_block bigint, placed_sig text,
  placed_at timestamptz, outcome smallint, credited bigint, settled_sig text, settled_at timestamptz, placed_log int, settled_block bigint,
  settled_log int, primary key (owner, nonce));
create index if not exists bets_settled_at on bets (settled_at);
create index if not exists bets_owner_placed on bets (owner, placed_at desc);
create index if not exists bets_open on bets (owner, slot) where outcome is null;
create table if not exists grants (owner text primary key, ip text, sig text, at timestamptz not null default now());
create table if not exists cursors (account text primary key, block bigint not null);
create table if not exists players (owner text primary key, handle text generated always as (left(owner, 6) || '…' || right(owner, 4)) stored,
  first_seen timestamptz, onboarded_at timestamptz, grant_sig text, onboard_sigs text[], last_active timestamptz);
create table if not exists transfers (owner text not null, kind text not null check (kind in ('grant', 'deposit', 'withdraw')),
  amount bigint not null, sig text not null, at timestamptz not null, primary key (sig, kind, owner));
create index if not exists transfers_owner_at on transfers (owner, at desc);
create table if not exists ticks (asset smallint not null default 0, ts_ms bigint not null, price_e8 bigint not null,
  at timestamptz not null default now(), primary key (ts_ms, asset));
create table if not exists touches (asset smallint, k bigint, j int, ts_ms bigint not null, sig text, primary key (asset, k, j));
create table if not exists service_minutes (minute timestamptz primary key, ticks int, quotes int, settles int, voids int,
  faucet int, relays int, fee_wei numeric, lag_ms_p50 int, players int);
create table if not exists service_tx (id uuid primary key, kind text not null, sig text, ok bool not null, err text,
  gas_used bigint, gas_limit bigint, fee_wei numeric, at timestamptz not null);
-- the markets upgrade (2026-10-10) on a database made before it: its rows are SOL, asset 0 (a no-op once applied)
alter table bets add column if not exists asset smallint not null default 0;
alter table ticks add column if not exists asset smallint not null default 0;
-- the activity feed (2026-10-10): log indexes (its ids are tx:logIndex) and the settle's block; null on older rows
alter table bets add column if not exists placed_log int, add column if not exists settled_block bigint, add column if not exists settled_log int;
create index if not exists bets_placed_at on bets (placed_at);
do $$ begin
  if (select array_length(conkey, 1) from pg_constraint where conrelid = 'ticks'::regclass and contype = 'p') = 1 then
    alter table ticks drop constraint ticks_pkey, add primary key (ts_ms, asset);
  end if;
end $$;`;

export function openDb(url: string, log: (cls: string, msg: string) => void): Db {
  const db = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  db.on('error', (e) => log('db-error', e.message));   // an idle client's error would otherwise crash the process
  return db;
}
/** Idempotent. Not bound by the 3 s query limit: the markets upgrade rebuilds the ticks key once (7 days of ticks). */
export const migrate = (db: Db) => db.query({ text: SCHEMA, query_timeout: 120_000 } as pg.QueryConfig);

/** Rolling-window P&L per wallet: Σ(credited − stake) over bets SETTLED in the last `hours` (a VOID nets 0), best first. */
export async function periodPnl(db: Db, hours: number): Promise<{ owner: string; pnl: string }[]> {
  return (await db.query(`select owner, sum(credited - stake)::text as pnl from bets
    where settled_at > now() - make_interval(hours => $1) group by owner order by sum(credited - stake) desc, owner`, [hours])).rows;
}

/** GET /player/:owner/history: the newest `limit` bets (open ones: outcome null) and stats over all of them. */
export async function history(db: Db, owner: string, limit: number) {
  const [b, s] = await Promise.all([
    db.query(`select asset, k, j, stake::text, mult, outcome, credited::text, placed_at, settled_at, placed_sig, settled_sig from bets
      where owner = $1 order by placed_at desc nulls first, nonce desc limit $2`, [owner, limit]),
    db.query(`select count(*)::int as taps, (count(*) filter (where outcome = 1))::int as wins,
      (count(*) filter (where outcome = 2))::int as losses, (count(*) filter (where outcome = 3))::int as voids,
      max(mult) filter (where outcome = 1) as best, coalesce(sum(credited - stake), 0)::text as pnl from bets where owner = $1`, [owner]),
  ]);
  const st = s.rows[0];
  return {
    bets: b.rows.map((r) => ({ asset: r.asset, k: Number(r.k), j: r.j, stake: r.stake, mult: r.mult, outcome: r.outcome, credited: r.credited,
      placedAt: r.placed_at?.getTime() ?? null, settledAt: r.settled_at?.getTime() ?? null, sig: r.placed_sig, settledSig: r.settled_sig })),
    stats: { taps: st.taps, wins: st.wins, losses: st.losses, voids: st.voids,
      hitRate: st.wins + st.losses ? st.wins / (st.wins + st.losses) : null, bestMult: st.best, pnl: st.pnl },
  };
}

/** GET /player/:owner/transfers: the newest `limit` money movements. */
export async function transfers(db: Db, owner: string, limit: number) {
  return (await db.query(`select kind, amount::text, sig, at from transfers where owner = $1 order by at desc, sig desc limit $2`, [owner, limit]))
    .rows.map((r) => ({ kind: r.kind as string, amount: r.amount as string, sig: r.sig as string, at: (r.at as Date).getTime() }));
}

/** Faucet grants in the last rolling hour (the faucet limits survive a restart). */
export async function recentGrants(db: Db): Promise<{ ip: string; at: number }[]> {
  return (await db.query(`select ip, at from grants where at > now() - interval '1 hour' order by at`)).rows.map((r) => ({ ip: r.ip, at: r.at.getTime() }));
}
export const recordGrant = (db: Db, owner: string, ip: string, sig: string) =>
  db.query('insert into grants (owner, ip, sig) values ($1, $2, $3) on conflict (owner) do nothing', [owner, ip, sig]);

/** Retention (hourly): the tick tape and hex touches 7 days, service transactions 30 days. */
export const prune = (db: Db) => db.query(`delete from ticks where ts_ms < (extract(epoch from now() - interval '7 days') * 1000)::bigint;
  delete from touches where ts_ms < (extract(epoch from now() - interval '7 days') * 1000)::bigint;
  delete from service_tx where at < now() - interval '30 days'`);

// ------------------------------------------------------------------ indexer writes (finalized blocks only; replays are no-ops)
// BetSettled carries (player, slot, asset, k): at most one open bet per (owner, slot), and a column is never bet on
// again once it settles, so a replay finds nothing open and changes nothing.
const SETTLE = `update bets b set outcome = u.outcome, credited = u.credited, settled_sig = u.sig, settled_at = u.at,
    settled_block = u.block, settled_log = u.log
  from unnest($1::text[], $2::smallint[], $3::smallint[], $4::bigint[], $5::smallint[], $6::bigint[], $7::text[], $8::timestamptz[],
    $9::bigint[], $10::int[]) as u(owner, slot, asset, k, outcome, credited, sig, at, block, log)
  where b.owner = u.owner and b.slot = u.slot and b.asset = u.asset and b.k = u.k and b.outcome is null`;

/** One indexed block range in one transaction: its rows, then its settlements, then the cursor. A failure writes
 *  nothing (the range is retried); a replay changes nothing. */
export async function writeRange(db: Db, cursor: string, toBlock: bigint, rows: Partial<Record<Table, unknown[][]>>, settles: unknown[][]) {
  const c = await db.connect();
  try {
    await c.query('begin');
    for (const [table, r] of Object.entries(rows) as [Table, unknown[][]][]) if (r.length) await insertRows(c, table, r);
    if (settles.length) await c.query(SETTLE, settles[0].map((_, i) => settles.map((r) => r[i])));
    await c.query('insert into cursors (account, block) values ($1, $2) on conflict (account) do update set block = excluded.block',
      [cursor, toBlock.toString()]);
    await c.query('commit');
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}

/** What the indexer needs to resume at the cursor: open bets (keeper) and granted owners (leaderboard). */
export async function loadState(db: Db, cursor: string) {
  const [c, open, players] = await Promise.all([
    db.query('select block from cursors where account = $1', [cursor]),
    db.query('select owner, asset, k, slot from bets where outcome is null'),
    db.query('select owner from players where onboarded_at is not null'),
  ]);
  return {
    block: c.rows[0] ? BigInt(c.rows[0].block) : null,
    open: open.rows.map((r) => ({ owner: r.owner as string, asset: Number(r.asset), k: Number(r.k), slot: Number(r.slot) })),
    granted: players.rows.map((r) => r.owner as string),
  };
}

/** A market's tick tape since `sinceMs`, oldest first (a restart rebuilds its ring, so columns spanning it still get a tape). */
export async function loadTicks(db: Db, asset: number, sinceMs: number): Promise<{ ts: number; px: bigint }[]> {
  return (await db.query('select ts_ms, price_e8 from ticks where asset = $1 and ts_ms >= $2 order by ts_ms', [asset, sinceMs])).rows
    .map((r) => ({ ts: Number(r.ts_ms), px: BigInt(r.price_e8) }));
}

export type ActivityRow = { kind: 'entry' | 'settle'; owner: string; nonce: string; slot: number; asset: number; k: number; j: number;
  stake: string; mult: number; outcome: number | null; credited: string | null; tx: Hex; block: number | null; log: number | null; at: Date };
/** The activity feed after a restart: the newest `limit` entries and settles of these markets (log null: indexed before
 *  the log index was kept). */
export async function activityRows(db: Db, assets: number[], limit: number): Promise<ActivityRow[]> {
  const r = await db.query(`(select 'entry' as kind, owner, nonce::text, slot, asset, k, j, stake::text, mult, null::smallint as outcome,
      null::text as credited, placed_sig as tx, placed_block as block, placed_log as log, placed_at as at
    from bets where placed_sig is not null and asset = any($1::smallint[]) order by placed_at desc limit $2)
    union all (select 'settle', owner, nonce::text, slot, asset, k, j, stake::text, mult, outcome, credited::text, settled_sig,
      settled_block, settled_log, settled_at from bets where settled_sig is not null and asset = any($1::smallint[]) order by settled_at desc limit $2)`,
    [assets, limit]);
  return r.rows.map((x) => ({ ...x, k: Number(x.k), block: x.block === null ? null : Number(x.block) }));
}

// Row layouts for insertRows / the writer queue (values in this order; bigints as strings).
const COLS = {
  bets: 'owner text, nonce bigint, asset smallint, k bigint, j int, stake bigint, mult int, slot smallint, placed_block bigint, placed_sig text, placed_at timestamptz, placed_log int',
  ticks: 'asset smallint, ts_ms bigint, price_e8 bigint, at timestamptz',
  touches: 'asset smallint, k bigint, j int, ts_ms bigint, sig text',
  transfers: 'owner text, kind text, amount bigint, sig text, at timestamptz',
  service_tx: 'id uuid, kind text, sig text, ok bool, err text, gas_used bigint, gas_limit bigint, fee_wei numeric, at timestamptz',
  service_minutes: 'minute timestamptz, ticks int, quotes int, settles int, voids int, faucet int, relays int, fee_wei numeric, lag_ms_p50 int, players int',
  // onboard_sigs comma-joined
  players: 'owner text, first_seen timestamptz, onboarded_at timestamptz, grant_sig text, onboard_sigs text, last_active timestamptz',
} as const;
export type Table = keyof typeof COLS;
export type Queue = (table: Table, row: unknown[]) => void;
export const serviceTx = (kind: string, sig: string | null, ok: boolean, err: string | null, gasUsed: bigint | null, gasLimit: bigint, feeWei: bigint) =>
  [randomUUID(), kind, sig, ok, err?.slice(0, 200) ?? null, gasUsed?.toString() ?? null, gasLimit.toString(), feeWei.toString(), new Date()];
/** The server refused the data itself (class 22 data exception, 23 constraint violation): retrying cannot help. */
export const badData = (e: unknown) => /^2[23]/.test((e as { code?: string })?.code ?? '');

/** Many rows in one statement. Replays are no-ops; players merge: earliest first_seen / onboarded_at, latest
 *  last_active, the first grant_sig / onboard_sigs written. */
export function insertRows(db: Db | pg.PoolClient, table: Table, rows: unknown[][]) {
  const cols = COLS[table].split(', ').map((c) => c.split(' ')), names = cols.map(([n]) => n).join(', ');
  const src = `unnest(${cols.map(([, ty], i) => `$${i + 1}::${ty}[]`).join(', ')}) as t(${names})`;
  const sql = table !== 'players' ? `insert into ${table} (${names}) select * from ${src} on conflict do nothing`
    : `insert into players as p (${names}) select owner, min(first_seen), min(onboarded_at), min(grant_sig),
        string_to_array(min(onboard_sigs), ','), max(last_active) from ${src} group by owner
      on conflict (owner) do update set first_seen = least(p.first_seen, excluded.first_seen),
        onboarded_at = least(p.onboarded_at, excluded.onboarded_at), grant_sig = coalesce(p.grant_sig, excluded.grant_sig),
        onboard_sigs = coalesce(p.onboard_sigs, excluded.onboard_sigs), last_active = greatest(p.last_active, excluded.last_active)`;
  return db.query(sql, cols.map((_, i) => rows.map((r) => r[i] ?? null)));
}

const MAX_ROWS = 20_000;   // queued per table; past this (a long outage) the oldest are dropped

/** Live writes, best-effort: q() only queues; once a second each table's rows go in
 *  one statement (<= 5000). A failed flush keeps its rows; nothing the services do ever waits on the database. */
export function startWriter(db: Db, log: (cls: string, msg: string) => void) {
  const bufs = new Map<Table, unknown[][]>();
  let running: Promise<void> | undefined;
  const q: Queue = (table, row) => {
    const b = bufs.get(table) ?? bufs.set(table, []).get(table)!;
    if (b.push(row) > MAX_ROWS) { b.shift(); log('db-drop', `${table} queue full: oldest row dropped`); }
  };
  const put = async (table: Table, rows: unknown[][]): Promise<void> => {
    try { await insertRows(db, table, rows); }
    catch (e) {
      if (!badData(e)) throw e;
      if (rows.length === 1) return log('db-drop', `${table}: ${(e as Error).message}`);
      await put(table, rows.slice(0, rows.length >> 1)); await put(table, rows.slice(rows.length >> 1));
    }
  };
  const drain = async () => {
    for (const [table, b] of bufs) {
      if (!b.length) continue;
      const rows = b.splice(0, 5000);
      try { await put(table, rows); }
      catch (e) {
        log('db-error', `${table}: ${(e as Error).message}`);
        b.unshift(...rows); b.splice(0, Math.max(0, b.length - MAX_ROWS));
        break;
      }
    }
  };
  const flush = () => (running ??= drain().finally(() => { running = undefined; }));
  const left = () => [...bufs.values()].reduce((n, b) => n + b.length, 0);
  const timer = setInterval(flush, 1000).unref();
  const stop = async () => {
    clearInterval(timer);
    await running;
    for (let n = left(); n; n = left()) { await flush(); if (left() >= n) break; }
  };
  return { q, flush, stop };
}
