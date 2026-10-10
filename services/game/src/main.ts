// Hexit Monad services in one process (docs/monad/DECISIONS.md "Repo layout"): the 6-venue index on its 100 ms grid
// (src/feed/{sources,index,grid}.ts) feeds, per market (BTC/USD and MON/USD), the tick tape, the recorder's per-column
// tape signatures and the quoter; the keeper, the indexer and the API (relayer + SSE /stream) run beside them for all
// markets, on one shared credit balance per player.
// Usage: node src/main.ts [feed-config.json]. Never run a second copy: the relayer and keeper keep their nonces here.
// Needs the markets upgrade on chain: band heights and tape move limits are read from HexitGame.markets(asset).
//
// Env: HEXIT_DEPLOYMENT (default <repo>/deployment/monad.json), HEXIT_KEY_{RECORDER,QUOTER,RELAYER,KEEPER} (0x key or the
// key file's JSON; else keys/monad/<role>.json), DATABASE_URL (optional), PORT, HEXIT_RPC_SEND / HEXIT_RPC_READ /
// HEXIT_RPC_WS ('' = no WS), HEXIT_FINALITY (finalized | safe | latest), HEXIT_LOG_WINDOW, HEXIT_CORS_ORIGINS.
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, defineChain, formatEther, http, isAddressEqual, type Hex, type LocalAccount } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getBalance, getTransactionReceipt, readContract } from 'viem/actions';
import { decodeGameLogs, gameDomain, hexitGameAbi, monadTestnet, parseDeployment, signTape, tHi, type Deployment } from '@hexit/monad';
import { ASSET_ID, HexitIndex, type Asset } from './feed/index.ts';
import { connect, VENUES } from './feed/sources.ts';
import { clockGate, DEFAULTS, indexConfig, loadConfig, runGrid } from './feed/grid.ts';
import { activityRows, loadTicks, migrate, openDb, prune, serviceTx, startWriter, type Queue } from './db.ts';
import { makeSender, type Sent, type TxStatus } from './sender.ts';
import { TickRing, tapeFor } from './tape.ts';
import { startQuoter } from './quoter.ts';
import { startKeeper, type SignedTape } from './keeper.ts';
import { colKey, startIndexer } from './indexer.ts';
import { startApi, type Market } from './api.ts';
import { ActivityRing, fromEvent, seedActivity } from './activity.ts';

const ROOT = new URL('../../../', import.meta.url).pathname;
/** SPEC-MONAD §4: the testnet role addresses. A key that derives anything else aborts the start. */
const SPEC_ROLES = { recorder: '0x204E9C68b9E6da4A0506886892Dd36A0da08738D', quoter: '0x78774441a9514F68e042be1fe7AB53cBf380C3bd',
  keeper: '0x6628466DA25dc84516c52a79F3089aCEE4051220', relayer: '0x20df2Af4E74DC889eC6cEAcb089faD8B5a1d36A6' } as const;
/** What the chain does not hold about a market (owner, 2026-10-10: BTC/USD and MON/USD). volAnn: the quoter's volatility
 *  prior, whose 0.8x is the floor under the live estimates. Owner, 2026-10-10: bands cut 5x (BTC) and 2x (MON) so the line
 *  crosses tiles, and the priors cut by the same ratio (0.40 -> 0.08, 1.30 -> 0.65) so a quiet board prices as before;
 *  a busy market prices off the live estimates (realised 1 min to 1 h: BTC 30-35 %, MON 105-124 %); decimals: the
 *  price digits the app shows, each market's common venue tick. Band height and move limit: HexitGame.markets(asset). */
const INFO: Partial<Record<Asset, { name: string; volAnn: number; decimals: number }>> = {
  BTC: { name: 'Bitcoin', volAnn: 0.08, decimals: 1 },
  MON: { name: 'Monad', volAnn: 0.65, decimals: 5 },
};

/** A role key from HEXIT_KEY_<ROLE> or keys/monad/<role>.json, checked against the deployment (and SPEC-MONAD §4 on
 *  testnet). Accepts a bare 0x key or `cast wallet new --json` output (array, or {data:[...]}). Never printed: no error
 *  message here carries any of its text. */
function loadKey(role: keyof typeof SPEC_ROLES, d: Deployment): LocalAccount {
  const name = `HEXIT_KEY_${role.toUpperCase()}`, file = `${ROOT}keys/monad/${role}.json`;
  const raw = (process.env[name] ?? (existsSync(file) ? readFileSync(file, 'utf8') : '')).trim();
  let pk: unknown = raw, a: LocalAccount;
  if (!raw.startsWith('0x')) {
    try { const j = JSON.parse(raw), e = Array.isArray(j) ? j[0] : Array.isArray(j?.data) ? j.data[0] : j; pk = e?.private_key; } catch { pk = null; }
  }
  if (typeof pk !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error(`${role} key: none in ${name} or ${file}`);
  try { a = privateKeyToAccount(pk as Hex); } catch { throw new Error(`${role} key: not a valid secp256k1 key`); }
  if (!isAddressEqual(a.address, d.roles[role])) throw new Error(`${role} key derives ${a.address}, the deployment says ${d.roles[role]}`);
  if (d.chainId === 10143 && !isAddressEqual(a.address, SPEC_ROLES[role])) throw new Error(`${role} key derives ${a.address}, SPEC-MONAD §4 says ${SPEC_ROLES[role]}`);
  return a;
}

/** At most one line per event class per second; the rest are counted into the next line. */
function throttledLog() {
  const last = new Map<string, { at: number; n: number }>();
  return (cls: string, msg: string) => {
    const s = last.get(cls) ?? { at: 0, n: 0 }, now = Date.now();
    if (now - s.at < 1000) { s.n++; last.set(cls, s); return; }
    console.log(`${new Date(now).toISOString()} [${cls}] ${msg}${s.n ? ` (+${s.n} more)` : ''}`);
    last.set(cls, { at: now, n: 0 });
  };
}

const log = throttledLog();
const d = parseDeployment(JSON.parse(readFileSync(process.env.HEXIT_DEPLOYMENT ?? `${ROOT}deployment/monad.json`, 'utf8')));
const testnet = d.chainId === 10143, env = (k: string, v: string) => process.env[k] ?? v;
const [recorder, quoterKey, relayerKey, keeperKey] = (['recorder', 'quoter', 'relayer', 'keeper'] as const).map((r) => loadKey(r, d));

// SPEC-MONAD §1 RPC plan: sends + simulations on monadinfra, reads + logs on Ankr, live logs on QuickNode WS.
// Checked 2026-10-09 (read-only): all three cap eth_getLogs at 100 blocks (SPEC-MONAD's 1,000 for Ankr no longer holds).
const chain = testnet ? monadTestnet : defineChain({ ...monadTestnet, id: d.chainId, rpcUrls: { default: { http: [d.rpc.http] } }, contracts: {} });
const client = (url: string) => createPublicClient({ chain, transport: http(url, { timeout: 10_000, retryCount: 1 }) });
const send = client(env('HEXIT_RPC_SEND', testnet ? 'https://rpc-testnet.monadinfra.com' : d.rpc.http));
const read = client(env('HEXIT_RPC_READ', testnet ? 'https://rpc.ankr.com/monad_testnet' : d.rpc.http));
const finality = env('HEXIT_FINALITY', 'finalized') as 'finalized' | 'safe' | 'latest';
const dom = gameDomain(d.game, d.chainId);

// ---------------------------------------------------------------- records and counters
const db = process.env.DATABASE_URL ? openDb(process.env.DATABASE_URL, log) : null;
if (db) await migrate(db).catch((e) => log('db-error', `migrate: ${(e as Error).message}`));
const writer = db ? startWriter(db, log) : null, q: Queue = writer?.q ?? (() => {});
type Stat = { ok: number; failed: number };
const stats: Record<string, Stat> = {}, rejects: Record<string, number> = {};
const reject = (key: string) => { rejects[key] = (rejects[key] ?? 0) + 1; };
let quotes = 0, feeWei = 0n;
const txs = new Map<Hex, TxStatus>();
const onDone = (s: Sent) => {
  const ok = s.receipt?.status === 'success', fee = s.receipt ? s.gas * s.receipt.effectiveGasPrice : 0n;   // Monad charges the gas LIMIT
  (stats[s.kind] ??= { ok: 0, failed: 0 })[ok ? 'ok' : 'failed']++;
  feeWei += fee;
  if (!ok) reject(`${s.kind}:${s.error}`);
  q('service_tx', serviceTx(s.kind, s.hash, ok, s.error, s.receipt?.gasUsed ?? null, s.gas, fee));
};
const relayer = makeSender({ account: relayerKey, chainId: d.chainId, to: d.game, send, txs, log, onDone });
const keeperSender = makeSender({ account: keeperKey, chainId: d.chainId, to: d.game, send, txs, log, onDone });

// ---------------------------------------------------------------- markets: the feed's assets, each listed on chain
const cfg = process.argv[2] ? loadConfig(process.argv[2]) : { ...DEFAULTS, clock: { ...DEFAULTS.clock, source: 'none' as const } };
type Live = Market & { sym: Asset; volAnn: number; nextK: number | null; quoter?: ReturnType<typeof startQuoter>; n: { ticks: number; gaps: number; refused: number } };
const markets: Live[] = [];
for (const sym of cfg.assets) {
  const info = INFO[sym] ?? die(`${sym}: no market info (name, vol prior, decimals) in main.ts`), asset = ASSET_ID[sym];
  const [rowE8, maxMoveE8, enabled] = await marketOnChain(asset);
  if (rowE8 <= 0n) die(`${sym} (asset ${asset}) is not a market on ${d.game}`);
  const ring = new TickRing(300_000, maxMoveE8);   // the chain's tape move limit, so a tape never fails MoveTooLarge
  if (db) for (const t of await loadTicks(db, asset, Date.now() - 300_000).catch(() => [])) ring.push(t);
  markets.push({ asset, sym, symbol: `${sym}/USD`, ...info, rowE8, maxMoveE8, enabled, ring, quotes: null, nextK: null, n: { ticks: 0, gaps: 0, refused: 0 } });
}
function die(msg: string): never { throw new Error(msg); }
/** HexitGame.markets(asset): (rowE8, maxMoveE8, enabled, maxLiab, openLiab). Retried: the start needs it. */
async function marketOnChain(asset: number) {
  for (let i = 1; ; i++) {
    try { return await readContract(read, { address: d.game, abi: hexitGameAbi, functionName: 'markets', args: [BigInt(asset)] }); }
    catch (e) { if (i === 5) die(`markets(${asset}) on ${d.game}: ${(e as Error).message.split('\n')[0]} (is the markets upgrade live?)`); }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const sum = (f: keyof Live['n']) => markets.reduce((a, m) => a + m.n[f], 0);

// ---------------------------------------------------------------- tape: index ticks in memory (+ Postgres) and signed column tapes
const tapes = new Map<number, SignedTape>();   // by colKey(asset, k)
/** Every column of market m whose span has ended (a tick at or after t_hi exists): its tape, signed by the recorder. */
function signTapes(m: Live) {
  const first = m.ring.ticks[0], last = m.ring.last(), asset = m.asset;
  if (!first || !last) return;
  m.nextK ??= Math.ceil((first.ts + 834) / 5000);   // the first column whose t_lo the ring reaches
  while (tHi(m.nextK) <= last.ts) {
    const k = m.nextK++, t = tapeFor(m.ring.ticks, k);
    if (!t) { log(`tape-missing-${m.sym}`, `${m.sym} column ${k}: the ticks do not reach back to t_lo; it will VOID`); continue; }
    const ts = t.map((x) => BigInt(x.ts)), px = t.map((x) => x.px);
    signTape(recorder, dom, asset, k, ts, px).then((sig) => void tapes.set(colKey(asset, k), { asset, k, ts, px, sig }),
      (e) => log('tape-error', `${m.sym} ${k}: ${(e as Error).message}`));
    for (const [col, old] of tapes) if (tHi(old.k) < last.ts - d.params.voidAfterMs - 60_000) tapes.delete(col);
  }
}

// ---------------------------------------------------------------- activity feed: the indexer's entries and settles (after a restart: Postgres first)
const activity = new ActivityRing(200), symbols = new Map(markets.map((m) => [m.asset, m.symbol]));
const seeded = db ? activityRows(db, [...symbols.keys()], activity.max)
  .then((rows) => seedActivity(activity, rows, symbols, async (tx) => decodeGameLogs((await getTransactionReceipt(read, { hash: tx })).logs, d.game), log))
  .then((n) => log('activity', `${n} items from Postgres`), (e) => log('db-error', `activity: ${(e as Error).message}`)) : null;

// ---------------------------------------------------------------- services
let ix: ReturnType<typeof startIndexer>, keeper: ReturnType<typeof startKeeper> | undefined;
const mon: Record<string, string> = {};   // MON balances, read every 30 s
const port = Number(process.env.PORT ?? 8788);
const api = startApi({ d, read, relayer, txs, granted: () => ix.granted, tapes, decided: () => ix.decided, markets, db, activity, log, reject,
  port, host: process.env.PORT ? '0.0.0.0' : '127.0.0.1',
  origins: env('HEXIT_CORS_ORIGINS', 'https://hexit-app.vercel.app').split(',').map((s) => s.trim()).filter(Boolean),
  health: () => ({ chainId: d.chainId, game: d.game, keeperAt: keeper?.at() ?? 0, ...ix.status(),
    markets: markets.map((m) => ({ asset: m.asset, symbol: m.symbol, lastTickTs: m.ring.last()?.ts ?? null, quotesAt: m.quoter?.at() ?? 0, ...m.n })),
    openColumns: ix.open.size, tapes: tapes.size, players: ix.granted.size, tx: stats, rejects, mon, db: !!db }) });
ix = startIndexer({ read, ws: env('HEXIT_RPC_WS', testnet ? 'wss://testnet-rpc.monad.xyz' : d.rpc.ws) || null, game: d.game,
  deployBlock: BigInt(d.deployBlock), finality, window: BigInt(env('HEXIT_LOG_WINDOW', '100')), db, log,
  onEvent: (e, at, live) => {
    const a = e.args as Record<string, any>, asset = Number(a.asset);
    if (a.player) api.forget(a.player);
    // a retuned market (setMarket) applies from the history replay too: one mined between the start's markets(asset)
    // read and the indexer's first head would otherwise wait for a restart (security review L4). The replay runs in block
    // order, so the last MarketSet applied is the chain's current one.
    if (e.eventName === 'MarketSet') {   // quotes, tapes, the relay's drift check and /config follow it at once
      const m = markets.find((x) => x.asset === asset);
      if (m) { m.rowE8 = a.rowE8; m.maxMoveE8 = m.ring.maxMoveE8 = a.maxMoveE8; m.enabled = a.enabled; }
      log('market-set', `asset ${asset}: rowE8 ${a.rowE8}, maxMoveE8 ${a.maxMoveE8}, maxLiab ${a.maxLiab}, enabled ${a.enabled}${m ? '' : ' (not served here)'}${live ? '' : ' (replay)'}`);
    }
    const item = fromEvent(e, at, symbols);   // the replay too (without Postgres it is the whole history): held until feedReady below
    if (item && activity.add(item)) api.broadcast(item, 'activity');
    if (!live) return;
    if (e.eventName === 'BetPlaced') api.broadcast({ t: 'bet', asset, player: a.player, k: Number(a.k), j: a.j, stake: String(a.stake), mult: a.mult,
      nonce: String(a.nonce), slot: a.slot, block: Number(e.blockNumber), hash: e.transactionHash });
    else if (e.eventName === 'BetSettled') api.broadcast({ t: 'settled', asset, player: a.player, k: Number(a.k), j: a.j, stake: String(a.stake), mult: a.mult,
      slot: a.slot, outcome: a.outcome, credited: String(a.credited), block: Number(e.blockNumber), hash: e.transactionHash });
    else if (e.eventName === 'HexTouched') api.broadcast({ t: 'touch', asset, k: Number(a.k), j: a.j, tsMs: Number(a.tsMs) });
  } });
for (const m of markets) m.quoter = startQuoter({ account: quoterKey, domain: dom, market: m, lockMarginMs: d.params.lockMarginMs,
  quoteMaxAgeMs: d.params.quoteMaxAgeMs, last: () => m.ring.last(), log, publish: (msg) => { m.quotes = msg; quotes++; api.broadcast(msg); } });
// ---------------------------------------------------------------- the index on its grid (clock gate 'none' by default: no chrony on the host)
const idx = new HexitIndex(indexConfig(cfg)), clock = clockGate(cfg.clock, (m) => log('clock', m)), bySym = new Map(markets.map((m) => [m.sym, m]));
const conns = cfg.venues.map((v) => connect(VENUES[v], cfg.assets, (ev) => idx.push(ev), (m) => log(`venue-${v}`, m)));
const grid = runGrid((t) => {
  for (const s of idx.sampleAt(t)) {
    const m = bySym.get(s.asset)!;   // the index samples exactly cfg.assets
    if (s.kind === 'gap' || !clock.ok()) { m.n.gaps++; log(`gap-${m.sym}`, `no ${m.sym} tick at ${t}: ${s.kind === 'gap' ? s.reason : 'clock'}`); continue; }
    const tick = { ts: s.ts, px: s.price_e8 };
    if (!m.ring.push(tick)) { m.n.refused++; log(`tick-refused-${m.sym}`, `${m.sym} ${s.ts}: moved more than maxMoveE8 per 100 ms`); continue; }
    m.n.ticks++;
    q('ticks', [m.asset, String(tick.ts), String(tick.px), new Date()]);
    m.quoter!.onTick(tick);
    api.broadcast({ t: 'ticks', asset: m.asset, ticks: [[tick.ts, String(tick.px)]] });
    signTapes(m);
  }
});
// the activity feed is whole once the indexer's first pass and the Postgres reload are in: streams opened before then get
// their backfill now, and items go out live from here on (review #3). The reload waits at most 20 s (it may read receipts
// one by one); what it adds later reaches only streams opened after it.
void Promise.all([ix.ready, Promise.race([seeded, new Promise((r) => setTimeout(r, 20_000))])]).then(api.feedReady);
// the keeper waits for the indexer's first pass (open bets as of now), the index and quotes do not
await ix.ready;
keeper = startKeeper({ sender: keeperSender, open: ix.open, decided: ix.decided, tapes, voidAfterMs: d.params.voidAfterMs, log, reject });

// ---------------------------------------------------------------- housekeeping: MON balances, stats, service_minutes, retention
const readMon = () => { for (const [role, a] of [['relayer', relayerKey], ['keeper', keeperKey]] as const)
  getBalance(read, { address: a.address }).then((b) => { mon[role] = formatEther(b); }, () => {}); };
readMon();
const timers = [setInterval(readMon, 30_000)];
const lagOf = (m: Live, now = Date.now()) => { const last = m.ring.last(); return last ? now - last.ts : null; };
timers.push(setInterval(() => {
  const feed = markets.map((m) => `${m.sym} ticks ${m.n.ticks} gaps ${m.n.gaps} refused ${m.n.refused} lag ${lagOf(m) ?? -1} ms`).join(', ');
  console.log(`${new Date().toISOString()} [stats] ${feed}; quotes ${quotes}; `
    + `tx ${JSON.stringify(stats)}; rejects ${JSON.stringify(rejects)}; open columns ${ix.open.size}; tapes ${tapes.size}; `
    + `players ${ix.granted.size}; sse ${api.clients()}; ${JSON.stringify(ix.status())}; MON ${JSON.stringify(mon)}`);
}, 10_000));
let minute = Math.floor(Date.now() / 60_000), lags: number[] = [], prev = structuredClone(stats), prevN = { ticks: sum('ticks'), quotes, feeWei };
timers.push(setInterval(() => {
  const now = Date.now(), m = Math.floor(now / 60_000), ls = markets.map((x) => lagOf(x, now));
  if (ls.every((l) => l !== null)) lags.push(Math.max(...(ls as number[])));   // the stalest market's tick lag
  if (m === minute) return;
  const ok = (kind: string) => (stats[kind]?.ok ?? 0) - (prev[kind]?.ok ?? 0), ticks = sum('ticks');
  lags.sort((a, b) => a - b);
  q('service_minutes', [new Date(minute * 60_000), ticks - prevN.ticks, quotes - prevN.quotes, ok('settle'), ok('void'), ok('faucet'),
    ok('bet') + ok('withdraw') + ok('deposit'), String(feeWei - prevN.feeWei), lags.length ? lags[lags.length >> 1] : null, ix.granted.size]);
  minute = m; lags = []; prev = structuredClone(stats); prevN = { ticks, quotes, feeWei };
  for (const [h, s] of txs) if (now - s.at > 3_600_000) txs.delete(h);
}, 1000));
if (db) timers.push(setInterval(() => prune(db).catch((e) => log('db-error', `prune: ${(e as Error).message}`)), 3_600_000));
log('start', `game services up: chain ${d.chainId}, game ${d.game}, api port ${port}, finality ${finality}, database ${db ? 'on' : 'off'}; `
  + markets.map((m) => `${m.symbol} (asset ${m.asset}) row ${m.rowE8} maxMove ${m.maxMoveE8}${m.enabled ? '' : ' CLOSED'}, ${m.ring.ticks.length} ticks from Postgres`).join('; '));

const stop = async () => {
  grid.stop(); clock.stop(); conns.forEach((c) => c.close()); markets.forEach((m) => m.quoter?.stop()); keeper?.stop(); ix.stop(); api.stop(); timers.forEach(clearInterval);
  console.log(`${new Date().toISOString()} [stop] ticks ${sum('ticks')} gaps ${sum('gaps')}; tx ${JSON.stringify(stats)}; rejects ${JSON.stringify(rejects)}`);
  await writer?.stop();
  await db?.end().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
