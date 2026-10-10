// Local end-to-end (npm run e2e), never a public network: anvil --network monad, the testnet's path to markets replayed
// (the pre-markets HexitGame from contracts/test/fixtures, a SOL bet on its old ABI, then contracts/script/Upgrade.s.sol,
// all in a throwaway clone of contracts/), a throwaway Postgres (docker) holding the pre-markets schema, and src/main.ts
// with throwaway keys and the live 6-venue index (BTC/USD + MON/USD). Then, as the app does it: the old SOL bet VOIDs
// through voidColumn(0, k); onboard -> bets on BTC and MON from one credit -> the keeper settles both with their
// recorder-signed tapes -> history / leaderboard / transfers; a burst past the credit; withdraw + deposit; and a restart
// that finds an open bet whose column got no tape in time -> voidColumn refunds it. Throughout, the activity feed (SSE
// event "activity", GET /activity): an item per BetPlaced / BetSettled log with its tx, kept across the restart, and a bet
// placed while the services were down reaching a stream opened the moment they answer again. Bets the relay refuses as
// QuoteStale (live price drift) are signed again on the next quotes. Needs Foundry >= 1.8.5, a built contracts/out, docker.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { constants, cpSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseAbi, recoverTypedDataAddress, toFunctionSelector,
  type Address, type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getTransactionCount, readContract, waitForTransactionReceipt } from 'viem/actions';
import { decodeGameLogs, gameDomain, hexitGameAbi, monadTestnet, multsHash, parseDeployment, placeBetForData, signBet, signDeposit, signQuote, signWithdraw,
  tapeTypedData, testUsdcAbi, tHi, tLo, usdcDomain } from '@hexit/monad';

const HERE = new URL('..', import.meta.url).pathname, ROOT = new URL('../../../', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'hexit-game-e2e-')), procs: ChildProcess[] = [], pgName = `hexit-game-e2e-${process.pid}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (m: string) => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`);
async function until<T>(f: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await Promise.resolve().then(f).catch(() => undefined);
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(200);
  }
}
let cleaned = false;
function cleanup() {
  if (cleaned) return; cleaned = true;
  for (const p of procs) p.kill('SIGKILL');
  try { execFileSync('docker', ['rm', '-f', pgName], { stdio: 'ignore' }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
process.on('exit', cleanup);

const port = 21000 + (process.pid % 5000), rpc = `http://127.0.0.1:${port}`, apiPort = port + 1, API = `http://127.0.0.1:${apiPort}`;
const pgPort = 26000 + (process.pid % 5000), DATABASE_URL = `postgres://postgres:e2e@127.0.0.1:${pgPort}/hexit`;
const svcLog = join(dir, 'services.log');
const BTC = 1, MON = 3, SOL_ROW = 5_000_000n;

// The pre-markets ABI and EIP-712 types (contracts/test/MarketsUpgrade.t.sol ILegacyGame): the live testnet code until the upgrade.
const legacyAbi = parseAbi([
  'function placeBetFor((address player, uint32 k, int32 j, uint64 stake, uint16 minMult, uint64 nonce, uint64 deadline) b, bytes sig, (uint32 k, int32 qJ0, uint64 refTsMs, uint64 refPriceE8, uint64 expiresMs) q, uint16[64] mults, bytes quoterSig)',
]);
const LEGACY_TYPES = {
  Bet: [{ name: 'player', type: 'address' }, { name: 'k', type: 'uint32' }, { name: 'j', type: 'int32' }, { name: 'stake', type: 'uint64' },
    { name: 'minMult', type: 'uint16' }, { name: 'nonce', type: 'uint64' }, { name: 'deadline', type: 'uint64' }],
  Quote: [{ name: 'k', type: 'uint32' }, { name: 'qJ0', type: 'int32' }, { name: 'refTsMs', type: 'uint64' }, { name: 'refPriceE8', type: 'uint64' },
    { name: 'expiresMs', type: 'uint64' }, { name: 'multsHash', type: 'bytes32' }],
} as const;
// The pre-markets Postgres tables these services wrote until the upgrade (db.ts before markets), to migrate in place.
const LEGACY_SCHEMA = `
create table bets (owner text not null, nonce bigint not null, k bigint not null, j int not null, stake bigint not null, mult int not null,
  slot smallint not null, placed_block bigint, placed_sig text, placed_at timestamptz, outcome smallint, credited bigint, settled_sig text,
  settled_at timestamptz, primary key (owner, nonce));
create table ticks (ts_ms bigint primary key, price_e8 bigint not null, at timestamptz not null default now());`;

try {
  // ---------------------------------------------------------------- chain, database
  step('postgres (docker) + anvil --network monad');
  execFileSync('docker', ['run', '-d', '--rm', '--name', pgName, '-e', 'POSTGRES_PASSWORD=e2e', '-e', 'POSTGRES_DB=hexit', '-p', `${pgPort}:5432`, 'postgres:16'], { stdio: 'ignore' });
  procs.push(spawn('anvil', ['--network', 'monad', '--port', String(port), '--block-time', '1', '--slots-in-an-epoch', '1'], { stdio: 'ignore' }));
  const boot = createPublicClient({ transport: http(rpc) });
  await until(() => boot.getChainId(), 15_000, 'anvil');
  const [admin, , , guardian] = await boot.request({ method: 'eth_accounts' as never }) as Address[];
  const [recorder, quoter, relayer, keeper, player, stranger] = Array.from({ length: 6 }, () => generatePrivateKey());
  const acc = (k: Hex) => privateKeyToAccount(k);
  for (const k of [relayer, keeper]) await boot.request({ method: 'anvil_setBalance' as never, params: [acc(k).address, '0x56bc75e2d63100000'] as never });   // 100 MON
  const chainId = await boot.getChainId(), chain = defineChain({ ...monadTestnet, id: chainId, rpcUrls: { default: { http: [rpc] } }, contracts: {} });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ chain, transport: http(rpc) });
  const mined = async (hash: Hex) => { const r = await waitForTransactionReceipt(pub, { hash }); assert.equal(r.status, 'success'); return r; };

  // ---------------------------------------------------------------- the pre-markets system, as on testnet before the upgrade
  step('deploy the pre-markets HexitGame (contracts/test/fixtures) + TestUSDC behind UUPS proxies (throwaway clone of contracts/)');
  const src = join(ROOT, 'contracts'), contracts = join(dir, 'contracts'), skip = [join(src, 'broadcast'), join(src, 'deployments')];
  cpSync(src, contracts, { recursive: true, preserveTimestamps: true, mode: constants.COPYFILE_FICLONE, filter: (p) => !skip.includes(p) });
  const art = (name: string) => { const j = JSON.parse(readFileSync(join(contracts, `out/${name}.sol/${name}.json`), 'utf8')); return { abi: j.abi, bytecode: j.bytecode.object as Hex }; };
  const proxyArt = art('ERC1967Proxy'), usdcArt = art('TestUSDC');
  const deploy = async (abi: unknown, bytecode: Hex, args: unknown[] = []) =>
    (await mined(await wallet.deployContract({ account: admin, abi: abi as never, bytecode, args: args as never }))).contractAddress!;
  const deployBlock = Number(await pub.getBlockNumber());
  const usdcImpl = await deploy(usdcArt.abi, usdcArt.bytecode);
  const usdc = await deploy(proxyArt.abi, proxyArt.bytecode, [usdcImpl, encodeFunctionData({ abi: testUsdcAbi, functionName: 'initialize', args: [admin] })]);
  const gameImpl = await deploy([], readFileSync(join(contracts, 'test/fixtures/HexitGame-testnet-20261009.hex'), 'utf8').trim() as Hex);
  const params = { recorders: [acc(recorder).address, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000'],
    quoter: acc(quoter).address, maxPayout: 2_500_000_000n, minStake: 100_000, guardian, maxColLiab: 20_000_000_000n, maxStake: 50_000_000,
    relayer: acc(relayer).address, maxMarketLiab: 100_000_000_000n, maxHexLiab: 4_000_000_000, dailyLossLimit: 1_000_000_000_000n,
    maxMoveE8: 25_000_000n, voidAfterMs: 10_000, gapMs: 250, quoteMaxAgeMs: 1500, lockMarginMs: 1000, maxOpen: 32 } as const;   // Deploy.s.sol's, voidAfterMs 120 s -> 10 s
  // initialize(owner, usdc, rowE8, Params) is the same in both implementations (MarketsUpgrade.t.sol initialises the legacy one with it)
  const game = await deploy(proxyArt.abi, proxyArt.bytecode, [gameImpl, encodeFunctionData({ abi: hexitGameAbi, functionName: 'initialize', args: [admin, usdc, SOL_ROW, params as never] })]);
  const HOUSE = 10_000_000_000_000n;
  const adminTx = async (address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) =>
    mined(await wallet.writeContract({ account: admin, address, abi, functionName, args } as never));
  await adminTx(usdc, testUsdcAbi, 'setMinter', [game, true]);
  await adminTx(usdc, testUsdcAbi, 'mint', [admin, HOUSE]);
  await adminTx(usdc, testUsdcAbi, 'approve', [game, HOUSE]);
  await adminTx(game, hexitGameAbi, 'houseDeposit', [HOUSE]);
  const depFile = join(contracts, 'deployments/local.json');   // the pre-markets record shape (deployment/monad.json today)
  mkdirSync(join(contracts, 'deployments'));
  writeFileSync(depFile, JSON.stringify({ chainId, rpc: { http: rpc, ws: `ws://127.0.0.1:${port}` }, game, gameImpl, usdc, usdcImpl,
    roles: { admin, guardian, recorder: acc(recorder).address, quoter: acc(quoter).address, keeper: acc(keeper).address, relayer: acc(relayer).address },
    deployBlock, market: { asset: 0, rowE8: String(SOL_ROW), maxMoveE8: String(params.maxMoveE8) },
    params: { minStake: '100000', maxStake: '50000000', maxPayout: '2500000000', maxHexLiab: '4000000000', maxColLiab: '20000000000',
      maxMarketLiab: '100000000000', dailyLossLimit: '1000000000000', maxMoveE8: '25000000', grant: '100000000', voidAfterMs: 10_000, gapMs: 250,
      quoteMaxAgeMs: 1500, lockMarginMs: 1000, maxOpen: 32 }, broadcast: '', buildInfo: '' }, null, 2));
  console.log(`  chain ${chainId}, game ${game} (impl ${gameImpl}), usdc ${usdc}, deployBlock ${deployBlock}`);

  // ---------------------------------------------------------------- SOL play on the old ABI: a bet left open across the upgrade
  const me = acc(player), olddom = gameDomain(game, chainId);
  step(`old code: grant ${me.address}, one SOL bet (old EIP-712 types) left open`);
  const relayerWallet = createWalletClient({ chain, transport: http(rpc), account: acc(relayer) });
  await mined(await relayerWallet.writeContract({ address: game, abi: hexitGameAbi, functionName: 'grant', args: [me.address], gas: 600_000n }));
  const blk = await pub.getBlock(), solRef = blk.timestamp * 1000n + 1000n, solK = Math.ceil((Number(solRef) + 5100 + 1000 + 834 + 2000) / 5000);
  const solPx = 15_000_000_000n, solJ = Number(solPx / SOL_ROW), mults = Array.from({ length: 64 }, () => 200);
  const oq = { k: solK, qJ0: solJ - 32, refTsMs: solRef, refPriceE8: solPx, expiresMs: solRef + 60_000n };
  const ob = { player: me.address, k: solK, j: solJ, stake: 1_000_000n, minMult: 101, nonce: 0n, deadline: blk.timestamp + 60n };
  const osig = await me.signTypedData({ domain: olddom, types: { Bet: LEGACY_TYPES.Bet }, primaryType: 'Bet', message: ob });
  const oqsig = await acc(quoter).signTypedData({ domain: olddom, types: { Quote: LEGACY_TYPES.Quote }, primaryType: 'Quote', message: { ...oq, multsHash: multsHash(mults) } });
  const solBet = await mined(await relayerWallet.writeContract({ address: game, abi: legacyAbi, functionName: 'placeBetFor', args: [ob, osig, oq, mults as never, oqsig], gas: 400_000n }));
  console.log(`  SOL column ${solK}, band ${solJ}: placed in block ${solBet.blockNumber} (${solBet.transactionHash})`);

  // ---------------------------------------------------------------- the markets upgrade (contracts/script/Upgrade.s.sol, as the admin runs it)
  step('upgrade with contracts/script/Upgrade.s.sol (admin, unlocked)');
  const forgeEnv: Record<string, string | undefined> = { ...process.env, HEXIT_GAME: game, HEXIT_ADMIN: admin, HEXIT_DEPLOY_OUT: 'deployments/local.json' };
  delete forgeEnv.HEXIT_KEY_ADMIN;   // the unlocked anvil admin sends
  execFileSync('forge', ['script', 'script/Upgrade.s.sol', '--rpc-url', rpc, '--broadcast', '--unlocked', '--sender', admin, '--slow', '-q'],
    { cwd: contracts, stdio: 'pipe', env: forgeEnv });
  // the broadcast writes nothing (security review L1); record() checks the chain, then writes gameImpl and markets
  assert.equal(parseDeployment(JSON.parse(readFileSync(depFile, 'utf8'))).gameImpl.toLowerCase(), gameImpl.toLowerCase(), 'the broadcast step left the record alone');
  execFileSync('forge', ['script', 'script/Upgrade.s.sol', '--sig', 'record()', '--rpc-url', rpc, '-q'], { cwd: contracts, stdio: 'pipe', env: forgeEnv });
  const raw = JSON.parse(readFileSync(depFile, 'utf8')), d = parseDeployment(raw);
  assert.notEqual(d.gameImpl, gameImpl, 'the record names the new implementation');
  assert.deepEqual(Object.keys(d.markets ?? {}).sort(), ['1', '3']);
  const [solRowOnChain, , solOpen] = await readContract(pub, { address: game, abi: hexitGameAbi, functionName: 'markets', args: [0n] });
  assert.deepEqual([solRowOnChain, solOpen], [SOL_ROW, false], 'SOL carried over, closed');
  console.log(`  impl ${d.gameImpl}; markets ${JSON.stringify(d.markets)}`);

  // ---------------------------------------------------------------- the pre-markets database (one SOL tick, one settled SOL bet)
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await until(async () => { const c = new pg.Client({ connectionString: DATABASE_URL }); await c.connect(); await c.end(); return true; }, 30_000, 'postgres');
  await db.connect();
  const oldTs = Math.floor(Date.now() / 100) * 100 - 60_000;
  await db.query(LEGACY_SCHEMA);
  await db.query('insert into ticks (ts_ms, price_e8) values ($1, 15000000000)', [oldTs]);
  await db.query(`insert into bets (owner, nonce, k, j, stake, mult, slot, outcome, credited) values ('0x000000000000000000000000000000000000dead', 0, 1, 2, 3, 150, 0, 2, 0)`);

  // ---------------------------------------------------------------- services
  const out = createWriteStream(svcLog, { flags: 'a' });
  const startServices = () => {
    const s = spawn('node', ['src/main.ts'], { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HEXIT_DEPLOYMENT: depFile,
      HEXIT_KEY_RECORDER: recorder, HEXIT_KEY_QUOTER: quoter, HEXIT_KEY_RELAYER: relayer, HEXIT_KEY_KEEPER: keeper,
      DATABASE_URL, PORT: String(apiPort), HEXIT_FINALITY: 'finalized' } });
    s.stdout!.pipe(out, { end: false }); s.stderr!.pipe(out, { end: false });
    procs.push(s);
    return s;
  };
  const get = async (path: string, init?: RequestInit) => { const r = await fetch(API + path, init); return { status: r.status, headers: r.headers, body: await r.json() as any }; };
  const post = (path: string, body: unknown) => get(path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) });
  const landed = (hash: string) => until(async () => { const s = (await get('/tx/' + hash)).body; if (s.status === 'failed') throw new Error(`${hash} failed: ${s.error}`); return s.status === 'confirmed' && s; }, 30_000, `tx ${hash}`);

  step('start src/main.ts (live venues, clock gate none)');
  let svc = startServices();
  await until(async () => { const h = (await get('/health')).body; return h.markets?.length === 2 && h.markets.every((m: any) => m.lastTickTs > Date.now() - 1500) && h; }, 30_000, 'index ticks on both markets');

  // SSE, as the app reads it: every message names its market
  const msgs: any[] = [], ac = new AbortController(), quotes = new Map<number, any>(), waiting = new Map<number, (() => void)[]>();
  /** The next quotes message of a market: a bet signed right after it carries a quote ~0.1 s old (anvil mines once a second). */
  const nextQuotes = (asset: number) => new Promise<void>((r) => waiting.set(asset, [...(waiting.get(asset) ?? []), r]));
  /** Each SSE message's data; a named event's name (event: activity) as its t. */
  const sse = async (path: string, onMsg: (m: any) => void, signal: AbortSignal) => {
    const r = await fetch(API + path, { signal }), rd = r.body!.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await rd.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      for (let i; (i = buf.indexOf('\n\n')) >= 0; buf = buf.slice(i + 2)) {
        let ev: string | undefined;
        for (const l of buf.slice(0, i).split('\n')) {
          if (l.startsWith('event: ')) ev = l.slice(7);
          if (l.startsWith('data: ')) { const m = JSON.parse(l.slice(6)); if (ev) m.t ??= ev; onMsg(m); }
        }
      }
    }
  };
  sse('/stream', (m) => {
    msgs.push(m);
    if (m.t === 'hello' && m.quotes) quotes.set(m.asset, m.quotes);
    if (m.t === 'quotes') { quotes.set(m.asset, m); waiting.get(m.asset)?.splice(0).forEach((f) => f()); }
  }, ac.signal).catch(() => {});
  await until(() => [BTC, MON].every((a) => quotes.get(a) && msgs.filter((m) => m.t === 'ticks' && m.asset === a).length >= 5), 15_000, 'SSE ticks + quotes on both markets');
  assert.deepEqual(msgs.filter((m) => m.t === 'hello').map((m) => m.asset).sort(), [BTC, MON], 'one hello per market');
  assert.ok(msgs.every((m) => Number.isInteger(m.asset)), 'every stream message names its market');   // (the SOL refund below: asset 0)
  for (const a of [BTC, MON]) assert.equal(quotes.get(a).cols.length, 18);
  // a filtered stream carries only its market; an unknown market is refused
  const monOnly: any[] = [], ac2 = new AbortController();
  sse('/stream?asset=3', (m) => monOnly.push(m), ac2.signal).catch(() => {});
  await until(() => monOnly.filter((m) => m.t === 'quotes').length >= 2, 5000, '?asset=3 stream');
  ac2.abort();
  assert.ok(monOnly.length > 4 && monOnly.every((m) => m.asset === MON), '?asset=3 carries MON only');
  assert.equal((await get('/stream?asset=0')).status, 400);

  const cfg = (await get('/config')).body;
  assert.equal(cfg.game, d.game); assert.equal(cfg.chainId, d.chainId); assert.equal(cfg.lockMarginMs, 1000); assert.equal(cfg.voidAfterMs, 10_000);
  assert.deepEqual(cfg.markets.map((m: any) => [m.asset, m.symbol, m.name, m.decimals, m.rowE8, m.maxMoveE8, m.enabled]),
    [[BTC, 'BTC/USD', 'Bitcoin', 1, d.markets!['1'].rowE8, d.markets!['1'].maxMoveE8, true], [MON, 'MON/USD', 'Monad', 5, d.markets!['3'].rowE8, d.markets!['3'].maxMoveE8, true]]);
  // the owner retunes MON's tape move limit to the research value (setMarket): the services follow the MarketSet event live
  step('setMarket(MON, maxMoveE8 10,000 -> 15,000): /config and the tape ring follow without a restart');
  await adminTx(game, hexitGameAbi, 'setMarket', [MON, { rowE8: 2_000n, maxMoveE8: 15_000n, maxLiab: 50_000_000_000n, enabled: true }]);
  await until(async () => (await get('/config')).body.markets.find((m: any) => m.asset === MON).maxMoveE8 === '15000', 15_000, 'MarketSet followed');
  const row = new Map<number, bigint>(cfg.markets.map((m: any) => [m.asset, BigInt(m.rowE8)]));
  for (const a of [BTC, MON]) assert.equal(quotes.get(a).rowE8, String(row.get(a)), 'quotes carry the row they were priced at');
  const pre = await fetch(API + '/bet', { method: 'OPTIONS', headers: { Origin: 'https://hexit-app.vercel.app' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://hexit-app.vercel.app');
  assert.equal((await fetch(API + '/config', { headers: { Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(API + '/config', { headers: { Origin: 'http://localhost:5173' } })).headers.get('access-control-allow-origin'), 'http://localhost:5173');

  step('Postgres migrated in place: old rows are SOL (asset 0), ticks keyed (ts_ms, asset)');
  assert.deepEqual((await db.query('select asset from ticks where ts_ms = $1', [oldTs])).rows, [{ asset: 0 }]);
  assert.deepEqual((await db.query(`select asset from bets where owner = '0x000000000000000000000000000000000000dead'`)).rows, [{ asset: 0 }]);
  const pk = await db.query(`select array_agg(a.attname::text order by k.i) as cols from pg_constraint c, unnest(c.conkey) with ordinality k(n, i)
    join pg_attribute a on a.attnum = k.n where c.conrelid = 'ticks'::regclass and a.attrelid = c.conrelid and c.contype = 'p'`);
  assert.deepEqual(pk.rows[0].cols, ['ts_ms', 'asset']);

  step(`the SOL bet from before the upgrade: no tape (SOL is not indexed any more) -> voidColumn(0, ${solK}) once its window opens`);
  const solRow = await until(async () => { const r = await db.query('select asset, outcome, credited, settled_sig from bets where placed_sig = $1', [solBet.transactionHash]);
    return r.rows[0]?.outcome && r.rows[0]; }, Math.max(0, tHi(solK) + 10_000 - Date.now()) + 30_000, 'SOL bet voided');
  assert.deepEqual([solRow.asset, solRow.outcome, solRow.credited], [0, 3, '1000000']);
  assert.equal((await pub.getTransaction({ hash: solRow.settled_sig })).input.slice(0, 10), toFunctionSelector('voidColumn(uint8,uint32,address[])'));
  console.log(`  VOID, 1 tUSDC refunded by ${solRow.settled_sig}`);

  // ---------------------------------------------------------------- onboard
  const dom = gameDomain(d.game, d.chainId);
  assert.deepEqual((await post('/onboard', { owner: me.address })).body, { done: true }, 'granted on the old code');
  let pl = (await get('/player/' + me.address)).body;
  assert.equal(pl.credit, '100000000');

  // ---------------------------------------------------------------- bets on both markets, one credit
  const relayerNonce = () => getTransactionCount(pub, { address: acc(relayer).address });
  const nonceAt = async () => { const p = (await get('/player/' + me.address)).body; for (let n = p.nonceBase; ; n++) if (!((p.nonceMask >>> (n - p.nonceBase)) & 1)) return n; };
  const quoteOf = (q: any, asset: number, k: number) => { const c = q.cols.find((x: any) => x.k === k);
    return { c, quote: { asset, rowE8: BigInt(q.rowE8), k, qJ0: c.qJ0, refTsMs: q.refTsMs, refPriceE8: q.refPriceE8, expiresMs: q.expiresMs } }; };
  /** A bet on column (asset, k) from the market's newest quote (as the app does): the offered band most likely to win, or the least. */
  const betFor = async (asset: number, k: number, pick: 'likely' | 'unlikely', nonce: number, stake: bigint, signer = me) => {
    await nextQuotes(asset);
    const { c, quote } = quoteOf(quotes.get(asset), asset, k);
    const offered = c.mults.map((m: number, i: number) => ({ m, j: c.qJ0 + i })).filter((x: any) => x.m >= 101).sort((a: any, b: any) => a.m - b.m);
    const x = pick === 'likely' ? offered[0] : offered.at(-1);
    const bet = { player: me.address, asset, k, j: x.j, stake, minMult: x.m, nonce: BigInt(nonce), deadline: BigInt(Math.floor(Date.now() / 1000) + 10) };
    return { j: x.j as number, mult: x.m as number, body: { bet, sig: await signBet(signer, dom, bet), mults: c.mults, quoteSig: c.sig, quote } };
  };
  /** POST /bet, signed again on the next quotes while the relay answers QuoteStale: the price moved a quarter band since the
   *  quote (MON's band is ~0.02 % of its price; ~7 % of taps, HANDOFF open decision 2), which is not what this run tests. */
  const placeBet = async (make: () => ReturnType<typeof betFor>) => {
    for (let n = 1; ; n++) {
      const x = await make(), r = await post('/bet', x.body);
      if (r.body.errName !== 'QuoteStale' || n === 4) return [x, r] as const;
      await sleep(1100);   // the relay takes 5 bets per second per player and IP
    }
  };
  const ahead = (asset: number, ms: number, after = 0) =>
    until(() => quotes.get(asset).cols.find((c: any) => tLo(c.k) >= Date.now() + ms && c.k > after)?.k, 5000, `a column ${ms} ms ahead`);

  step('refused before any MON is spent: a stranger\'s signature, a locked column, a closed market (SOL)');
  const n0 = await relayerNonce(), k = await ahead(BTC, 9000);
  const forged = await post('/bet', (await betFor(BTC, k, 'likely', await nonceAt(), 1_000_000n, acc(stranger))).body);
  assert.equal(forged.status, 400); assert.equal(forged.body.errName, 'BadSig');
  const lockedK = Math.floor((Date.now() - 834) / 5000) + 1;   // t_lo < now + 5.1 s: quoted and signed, but only the simulation can tell
  const qb0 = quotes.get(BTC), centre = Number(BigInt(qb0.refPriceE8) / row.get(BTC)!);
  const lq = { asset: BTC, rowE8: row.get(BTC)!, k: lockedK, qJ0: centre - 32, refTsMs: BigInt(qb0.refTsMs), refPriceE8: BigInt(qb0.refPriceE8), expiresMs: BigInt(qb0.expiresMs) };
  const lsig = await signQuote(acc(quoter), dom, lq, qb0.cols[0].mults);
  const lbet = { player: me.address, asset: BTC, k: lockedK, j: centre, stake: 1_000_000n, minMult: 101, nonce: BigInt(await nonceAt()), deadline: BigInt(Math.floor(Date.now() / 1000) + 10) };
  const locked = await post('/bet', { bet: lbet, sig: await signBet(me, dom, lbet), quote: lq, mults: qb0.cols[0].mults, quoteSig: lsig });
  assert.equal(locked.status, 400, JSON.stringify(locked.body)); assert.equal(locked.body.errName, 'Locked');
  const sbet = { ...lbet, asset: 0, k }, sq = { ...lq, asset: 0, k };   // an open column: the market is what refuses it
  const closed = await post('/bet', { bet: sbet, sig: await signBet(me, dom, sbet), quote: sq, mults: qb0.cols[0].mults, quoteSig: await signQuote(acc(quoter), dom, sq, qb0.cols[0].mults) });
  assert.equal(closed.body.errName, 'MarketClosed');
  const rbet = { ...lbet, k, nonce: BigInt(await nonceAt()) }, rq = { ...lq, k, rowE8: row.get(BTC)! + 1n };   // quoted at another band height
  const rowStale = await post('/bet', { bet: rbet, sig: await signBet(me, dom, rbet), quote: rq, mults: qb0.cols[0].mults, quoteSig: await signQuote(acc(quoter), dom, rq, qb0.cols[0].mults) });
  assert.equal(rowStale.body.errName, 'QuoteStale', JSON.stringify(rowStale.body));
  assert.ok((await get('/health')).body.rejects['bet:QuoteStale'] >= 1, 'a refusal before the simulation is counted');
  assert.equal(await relayerNonce(), n0, 'no transaction was sent for refused bets');
  await sleep(1100);   // the relay takes 5 requests per second per IP: the next second's bets are not refused for these

  // each signed on its market's newest quote and sent at once, as a tap does
  step(`a bet on each market, column ${k} (t_lo in ${tLo(k) - Date.now()} ms)`);
  const n1 = await nonceAt(), why = async (r: { status: number; body: any }) => `${JSON.stringify(r.body)}; rejects ${JSON.stringify((await get('/health')).body.rejects)}`;
  const [[xb, bb], [xm, bm]] = await Promise.all([placeBet(() => betFor(BTC, k, 'likely', n1, 1_000_000n)), placeBet(() => betFor(MON, k, 'unlikely', n1 + 1, 1_000_000n))]);
  console.log(`  BTC band ${xb.j} at ${xb.mult / 100}x, MON band ${xm.j} at ${xm.mult / 100}x`);
  assert.equal(bb.status, 200, await why(bb)); assert.equal(bm.status, 200, await why(bm));
  const [rb, rm] = await Promise.all([landed(bb.body.hash), landed(bm.body.hash)]);
  console.log(`  placed in blocks ${rb.block}, ${rm.block}`);
  pl = (await get('/player/' + me.address)).body;
  assert.equal(pl.credit, '98000000', 'one credit pays for both markets'); assert.equal(pl.openStake, '2000000');
  assert.deepEqual(pl.bets.map((b: any) => [b.asset, b.k, b.j]).sort(), [[BTC, k, xb.j], [MON, k, xm.j]].sort());
  await until(() => [BTC, MON].every((a) => msgs.some((m) => m.t === 'bet' && m.asset === a && m.player === me.address && m.k === k)), 10_000, 'SSE bet events per market');
  /** The log index of player's `eventName` (asset, k) log in a transaction: an activity id is tx:logIndex. */
  const logIdOf = async (hash: Hex, eventName: string, player: string, asset: number) => {
    const e = decodeGameLogs((await pub.getTransactionReceipt({ hash })).logs, d.game)
      .find((x) => x.eventName === eventName && (x.args as any).player === player && (x.args as any).asset === asset && (x.args as any).k === k);
    return `${hash}:${e!.logIndex}`;
  };
  step('activity feed: an entry per bet, with its own transaction');
  const entries = await until(() => { const a = [bb, bm].map((r) => msgs.find((m) => m.t === 'activity' && m.kind === 'entry' && m.tx === r.body.hash));
    return a.every(Boolean) && a; }, 10_000, 'SSE activity entries');
  for (const [a, x, asset, r] of [[entries[0], xb, BTC, rb], [entries[1], xm, MON, rm]] as const) {
    assert.equal(a.id, await logIdOf(a.tx, 'BetPlaced', me.address, asset));
    assert.deepEqual([a.player, a.handle, a.asset, a.symbol, a.k, a.j, a.stake, a.mult, a.block, a.outcome, a.credited, a.payout, a.backfill],
      [me.address, `${me.address.slice(0, 6)}…${me.address.slice(-4)}`, asset, asset === BTC ? 'BTC/USD' : 'MON/USD', k, x.j, '1000000', x.mult, r.block, null, null, null, undefined]);
    assert.ok(Math.abs(a.ts - Date.now()) < 30_000, 'block time in ms');
  }

  step(`keeper settles (BTC, ${k}) and (MON, ${k}) after t_hi (in ${tHi(k) - Date.now()} ms)`);
  const settled = await until(() => { const s = msgs.filter((m) => m.t === 'settled' && m.player === me.address && m.k === k); return s.length === 2 && s; }, tHi(k) - Date.now() + 20_000, 'SSE settled x2');
  for (const s of settled) console.log(`  ${s.asset === BTC ? 'BTC' : 'MON'} band ${s.j}: outcome ${['', 'WIN', 'LOSS', 'VOID'][s.outcome]}, credited ${s.credited}`);
  step('activity feed: a settle item per BetSettled log, with the keeper\'s transaction; GET /activity; the backfill on connect');
  const settleItems = await until(() => { const a = settled.map((s: any) => msgs.find((m) => m.t === 'activity' && m.kind === 'settle' && m.tx === s.hash
    && m.player === me.address && m.asset === s.asset)); return a.every(Boolean) && a; }, 10_000, 'SSE activity settles');
  for (const [a, s] of settleItems.map((a: any, i: number) => [a, settled[i]])) {
    assert.equal(a.id, await logIdOf(s.hash, 'BetSettled', me.address, s.asset));
    assert.deepEqual([a.k, a.j, a.outcome, a.credited, a.payout], [k, s.j, s.outcome, s.credited, s.outcome === 2 ? '0' : s.credited]);
  }
  const feedIds = [...entries, ...settleItems].map((a: any) => a.id);
  const feed = (await get('/activity?limit=100')).body.items;
  assert.deepEqual(feed.slice(0, 4).map((a: any) => a.id).sort(), [...feedIds].sort(), 'GET /activity: these four, newest first');
  assert.ok(feed.every((a: any, i: number) => i === 0 || a.block <= feed[i - 1].block), 'newest first');
  assert.ok(feed.every((a: any) => a.asset === BTC || a.asset === MON), 'served markets only (not the SOL bet)');
  assert.deepEqual((await get('/activity?limit=1')).body.items, feed.slice(0, 1));
  assert.deepEqual((await get('/activity?limit=0')).body.items, feed.slice(0, 1), 'limit 0 is 1, not the default 30');
  const back: any[] = [], ac3 = new AbortController();
  sse('/stream', (m) => { if (m.t === 'activity') back.push(m); }, ac3.signal).catch(() => {});
  await until(() => back.length >= feed.length, 5000, 'activity backfill on connect');
  ac3.abort();
  assert.ok(back.every((a) => a.backfill === true), 'flagged backfill');
  assert.deepEqual(back.map((a) => a.id), feed.slice(0, 30).map((a: any) => a.id).reverse(), 'the newest 30, newest last');
  assert.deepEqual(settled.map((s: any) => s.asset).sort(), [BTC, MON]);
  pl = (await get('/player/' + me.address)).body;
  const credited = settled.reduce((a: bigint, s: any) => a + BigInt(s.credited), 0n);
  assert.equal(pl.openStake, '0'); assert.equal(BigInt(pl.credit), 100_000_000n - 2_000_000n + credited, 'both payouts land in the one credit');
  for (const [asset, x] of [[BTC, xb], [MON, xm]] as const) {
    const tape = (await get(`/tape/${asset}/${k}`)).body;
    assert.equal(tape.asset, asset);
    assert.ok(Number(tape.ts[0]) <= tLo(k) && Number(tape.ts.at(-1)) >= tHi(k) && Number(tape.ts[1]) > tLo(k) && Number(tape.ts.at(-2)) < tHi(k), 'tape bounds');
    assert.equal(await recoverTypedDataAddress({ ...tapeTypedData(dom, asset, k, tape.ts.map(BigInt), tape.px.map(BigInt)), signature: tape.sig }), acc(recorder).address);
    const px = tape.px.map(Number), touches = msgs.filter((m) => m.t === 'touch' && m.asset === asset && m.k === k).map((m) => m.j);
    console.log(`  ${asset === BTC ? 'BTC' : 'MON'} tape ${tape.ts.length} ticks, ${Math.min(...px) / 1e8}..${Math.max(...px) / 1e8}; touched bands ${touches.join(', ')}`);
    const s = settled.find((m: any) => m.asset === asset);
    assert.equal(s.j, x.j); assert.equal(s.outcome === 1, touches.includes(s.j), 'WIN exactly on touched bands');
    await until(async () => (await db.query('select count(*)::int as n from touches where asset = $1 and k = $2', [asset, k])).rows[0].n === touches.length, 10_000, 'touches in Postgres');
    assert.ok((await db.query('select count(*)::int as n from ticks where asset = $1 and ts_ms between $2 and $3', [asset, tLo(k), tHi(k)])).rows[0].n >= 50, 'the tick tape in Postgres');
  }
  assert.equal((await get(`/tape/${MON}/${k - 1}`)).status, 404, 'a tape is served only once its column is decided on chain');

  step('history, leaderboard (all + daily), from Postgres and the chain');
  const hist = await until(async () => { const h = (await get(`/player/${me.address}/history`)).body; return h.bets.length === 3 && h.bets.every((b: any) => b.outcome) && h; }, 15_000, 'history');
  assert.deepEqual(hist.bets.map((b: any) => b.asset).sort(), [0, BTC, MON]);
  assert.equal(hist.stats.taps, 3); assert.equal(BigInt(hist.stats.pnl), credited - 2_000_000n);
  assert.ok(hist.bets.every((b: any) => /^0x[0-9a-f]{64}$/.test(b.sig) && /^0x[0-9a-f]{64}$/.test(b.settledSig)));
  const lball = await until(async () => { const l = (await get('/leaderboard?period=all')).body; return l.rows.find((r: any) => r.owner === me.address) && l; }, 15_000, 'leaderboard all');
  assert.equal(BigInt(lball.rows.find((r: any) => r.owner === me.address).total), 98_000_000n + credited);
  const daily = await until(async () => { const l = (await get('/leaderboard?period=daily')).body; return l.period === 'daily' && l.rows.find((r: any) => r.owner === me.address) && l; }, 15_000, 'leaderboard daily');
  assert.equal(BigInt(daily.rows.find((r: any) => r.owner === me.address).pnl), credited - 2_000_000n);

  // ---------------------------------------------------------------- a burst past the credit (E2E #1, security review H2), across both markets
  const p2 = acc(stranger);
  step(`burst: ${p2.address} sends 5 bets of 30 tUSDC at once (3 MON, 2 BTC) against 100 credit`);
  await landed((await post('/onboard', { owner: p2.address })).body.hash);
  const kb = await ahead(MON, 9000, k);
  await Promise.all([nextQuotes(MON), nextQuotes(BTC)]);
  const assets = [MON, MON, MON, BTC, BTC];
  /** Leg i on its market's newest quote: the i-th most likely offered band (MON 0-2, BTC 0-1), nonce i. */
  const leg = async (i: number) => {
    const asset = assets[i], { c, quote } = quoteOf(quotes.get(asset), asset, kb);
    const x = c.mults.map((m: number, n: number) => ({ m, j: c.qJ0 + n })).filter((y: any) => y.m >= 101).sort((a: any, b: any) => a.m - b.m)[asset === MON ? i : i - 3];
    const bet = { player: p2.address, asset, k: kb, j: x.j, stake: 30_000_000n, minMult: x.m, nonce: BigInt(i), deadline: BigInt(Math.floor(Date.now() / 1000) + 10) };
    return post('/bet', { bet, sig: await signBet(p2, dom, bet), mults: c.mults, quoteSig: c.sig, quote });
  };
  let burst = await Promise.all(assets.map((_, i) => leg(i)));
  // legs refused as QuoteStale (placeBet) go again on the next quotes, all at once, against the credit the others left
  for (let n = 0; n < 3 && burst.some((r) => r.body.errName === 'QuoteStale'); n++) {
    console.log(`  answers: ${burst.map((r) => r.body.errName ?? r.status).join(', ')}; the QuoteStale legs again`);
    await sleep(1100); await Promise.all([nextQuotes(MON), nextQuotes(BTC)]);
    burst = await Promise.all(burst.map((r, i) => (r.body.errName === 'QuoteStale' ? leg(i) : r)));
  }
  console.log(`  answers: ${burst.map((r) => r.body.errName ?? r.status).join(', ')}`);
  assert.equal(burst.filter((r) => r.status === 200).length, 3, JSON.stringify(burst.map((r) => r.body)));
  assert.deepEqual(burst.filter((r) => r.status !== 200).map((r) => r.body.errName), ['InsufficientCredit', 'InsufficientCredit']);
  for (const r of burst.filter((r) => r.status === 200)) await landed(r.body.hash);   // throws if one reverted
  assert.equal((await get('/player/' + p2.address)).body.openStake, '90000000');

  // ---------------------------------------------------------------- withdraw + deposit (relayed, gasless for the player)
  step('withdraw 5 tUSDC, deposit 2 back (Deposit + permit)');
  await sleep(1100);   // the burst may have spent this second's 5 relays per IP (the withdraw came back RateLimited once)
  const w = { player: me.address, amount: 5_000_000n, nonce: BigInt(await nonceAt()), deadline: BigInt(Math.floor(Date.now() / 1000) + 60) };
  const wr = await post('/withdraw', { ...w, sig: await signWithdraw(me, dom, w) });
  assert.equal(wr.status, 200, await why(wr)); await landed(wr.body.hash);
  assert.equal((await get('/player/' + me.address)).body.wallet, '5000000');
  const pn = BigInt((await get('/player/' + me.address)).body.permitNonce);
  const dep = { player: me.address, amount: 2_000_000n, nonce: BigInt(await nonceAt()), deadline: BigInt(Math.floor(Date.now() / 1000) + 60) };
  const ds = await signDeposit(me, dom, usdcDomain(d.usdc, d.chainId), dep, pn);
  const dr = await post('/deposit', { ...dep, ...ds });
  assert.equal(dr.status, 200, JSON.stringify(dr.body)); await landed(dr.body.hash);
  assert.equal((await get('/player/' + me.address)).body.wallet, '3000000');
  const tr = await until(async () => { const t = (await get(`/player/${me.address}/transfers`)).body.transfers; return t.length === 3 && t; }, 15_000, 'transfers');
  assert.deepEqual(tr.map((t: any) => t.kind).sort(), ['deposit', 'grant', 'withdraw']);

  // ---------------------------------------------------------------- the faucet's per-IP limit says when it frees up
  step('faucet: 3 grants per IP per rolling hour; the 4th is refused with FaucetLimit and the seconds to wait, nothing sent');
  const viaIp = (owner: string) => get('/onboard', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' }, body: JSON.stringify({ owner }) });
  for (let i = 0; i < 3; i++) { const r = await viaIp(acc(generatePrivateKey()).address); assert.equal(r.status, 200, JSON.stringify(r.body)); await landed(r.body.hash); }
  const n4 = await relayerNonce(), r4 = await viaIp(acc(generatePrivateKey()).address);
  assert.equal(r4.status, 429); assert.equal(r4.body.errName, 'FaucetLimit', JSON.stringify(r4.body));
  assert.ok(r4.body.retryAfterS > 3500 && r4.body.retryAfterS <= 3600, `retryAfterS ${r4.body.retryAfterS}`);
  assert.equal(await relayerNonce(), n4, 'no grant was sent');
  assert.ok((await get('/health')).body.rejects['faucet:FaucetLimit'] >= 1);
  console.log(`  4th grant from one IP: ${r4.status} ${r4.body.errName}, retry in ${r4.body.retryAfterS} s`);

  // ---------------------------------------------------------------- restart: no tape in time -> voidColumn
  const k2 = await ahead(MON, 9000, kb), n3 = await nonceAt(), [, b3] = await placeBet(() => betFor(MON, k2, 'likely', n3, 3_000_000n));
  assert.equal(b3.status, 200, JSON.stringify(b3.body)); await landed(b3.body.hash);
  await until(async () => (await db.query('select 1 from bets where placed_sig = $1', [b3.body.hash])).rowCount, 10_000, 'bet in Postgres');
  step(`stop the services before (MON, ${k2}) ends; restart after its void window opens (t_hi + 10 s)`);
  ac.abort(); svc.kill('SIGTERM');
  await until(() => svc.exitCode !== null, 10_000, 'clean stop');
  assert.equal(svc.exitCode, 0);
  // a row from before the log index was kept: after the restart its item comes back with its id from the receipt
  assert.equal((await db.query('update bets set placed_log = null where placed_sig = $1', [bb.body.hash])).rowCount, 1);
  // a bet that lands while nothing indexes (the relayer and quoter keys straight on the chain): a stream opened the moment
  // the server answers again must still get its entry, once (review #3: it came back only to streams opened later)
  const pl0 = await readContract(pub, { address: d.game, abi: hexitGameAbi, functionName: 'playerOf', args: [me.address] });
  let dn = Number(pl0[2]); for (let m = Number(pl0[3]); m & 1; m >>>= 1) dn++;
  const db0 = await pub.getBlock(), dref = db0.timestamp * 1000n, dk = Math.ceil((Math.max(Number(dref), Date.now()) + 5100 + 1000 + 834 + 3000) / 5000);
  const dpx = BigInt(quotes.get(BTC).refPriceE8), dj = Number(dpx / row.get(BTC)!), dmults = Array.from({ length: 64 }, () => 200);
  const dq = { asset: BTC, rowE8: row.get(BTC)!, k: dk, qJ0: dj - 32, refTsMs: dref, refPriceE8: dpx, expiresMs: dref + 60_000n };
  const dbet = { player: me.address, asset: BTC, k: dk, j: dj, stake: 1_000_000n, minMult: 101, nonce: BigInt(dn), deadline: db0.timestamp + 60n };
  const down = await mined(await relayerWallet.sendTransaction({ to: d.game, gas: 700_000n,
    data: placeBetForData(dbet, await signBet(me, dom, dbet), dq, dmults as never, await signQuote(acc(quoter), dom, dq, dmults)) }));
  console.log(`  while down: a BTC bet on column ${dk} in block ${down.blockNumber} (${down.transactionHash})`);
  await sleep(Math.max(0, tHi(k2) + 12_500 - Date.now()));
  step('restart (the migration runs again: a no-op); a stream opened the moment the API answers');
  svc = startServices();
  const early: any[] = [], ac4 = new AbortController();
  let earlyIx: number | null = null;
  void (async () => { for (;;) {
    try { return await sse('/stream', (m) => { if (earlyIx === null) { earlyIx = -1; get('/health').then((h) => { earlyIx = h.body.indexedBlock; }, () => {}); }
      if (m.t === 'activity') early.push(m); }, ac4.signal); }
    catch { if (ac4.signal.aborted) return; await sleep(10); }
  } })();
  const voided = await until(async () => {
    const r = await db.query('select asset, outcome, credited, settled_sig from bets where placed_sig = $1', [b3.body.hash]);
    return r.rows[0]?.outcome && r.rows[0];
  }, 30_000, 'voidColumn after restart');
  assert.deepEqual([voided.asset, voided.outcome, voided.credited], [MON, 3, '3000000']);
  const vtx = await pub.getTransaction({ hash: voided.settled_sig });
  assert.equal(vtx.input.slice(0, 10), toFunctionSelector('voidColumn(uint8,uint32,address[])'));
  console.log(`  (MON, ${k2}): VOID, 3 tUSDC refunded by ${voided.settled_sig}`);
  step('activity after the restart: the earlier items from Postgres (same ids), the burst\'s settle one item per bet, the VOID refund');
  const after = await until(async () => { const f = (await get('/activity?limit=100')).body.items;
    return feedIds.every((id) => f.some((a: any) => a.id === id)) && f.some((a: any) => a.tx === voided.settled_sig) && f; }, 30_000, 'activity after restart');
  const vItem = after.find((a: any) => a.tx === voided.settled_sig);
  assert.deepEqual([vItem.kind, vItem.asset, vItem.k, vItem.outcome, vItem.credited, vItem.payout], ['settle', MON, k2, 3, '3000000', '3000000']);
  const burstSettle = await until(async () => { const f = (await get('/activity?limit=100')).body.items
    .filter((a: any) => a.kind === 'settle' && a.player === p2.address && a.k === kb); return f.length === 3 && f; }, 30_000, 'the burst\'s settle items');
  // the 3 bets that fit the credit span one or two markets: one settle transaction per market, carrying an item per bet
  assert.equal(new Set(burstSettle.map((a: any) => a.tx)).size, new Set(burstSettle.map((a: any) => a.asset)).size, 'one settle transaction per market');
  assert.equal(new Set(burstSettle.map((a: any) => a.id)).size, 3, 'an item per bet');
  console.log(`  ${after.length} items; burst settle ${burstSettle[0].tx}: ${burstSettle.map((a: any) => ['', 'WIN', 'LOSS', 'VOID'][a.outcome]).join(', ')}`);
  const dItem = await until(() => early.find((m) => m.tx === down.transactionHash && m.kind === 'entry'), 10_000, 'the bet placed while down, on the stream opened at the restart');
  ac4.abort();
  assert.deepEqual([dItem.player, dItem.asset, dItem.k, dItem.j, dItem.block], [me.address, BTC, dk, dj, Number(down.blockNumber)]);
  assert.equal(new Set(early.map((m) => m.id)).size, early.length, 'no item twice on that stream');
  console.log(`  that stream: ${early.length} items, the bet placed while down ${dItem.backfill ? 'in its backfill' : 'live'}; it opened with the indexer at block ${earlyIx} (the bet: ${down.blockNumber})`);

  step('what it cost');
  const txs = (await db.query(`select kind, ok, gas_used::int, gas_limit::int, fee_wei::text from service_tx order by at`)).rows;
  console.log('  service transactions (gasUsed / limit):');
  for (const t of txs) console.log(`    ${t.kind.padEnd(8)} ${t.ok ? 'ok    ' : 'FAILED'} ${String(t.gas_used).padStart(7)} / ${String(t.gas_limit).padStart(7)}  fee ${(Number(t.fee_wei) / 1e18).toFixed(5)} MON`);
  assert.ok(txs.length >= 9 && txs.every((t) => t.ok && t.gas_used <= t.gas_limit), 'every service transaction landed within its limit');
  svc.kill('SIGTERM');
  await until(() => svc.exitCode !== null, 10_000, 'clean stop');
  const logText = readFileSync(svcLog, 'utf8');
  assert.ok(!/migrate:/.test(logText), 'both migrations ran clean');
  console.log(`  services.log: ${logText.split('\n').filter((l) => /\[(gap|tick-refused|tape-missing)-/.test(l)).length} gap/refused/missing-tape lines`);
  step('stopped');
  await db.end();
  step('e2e passed');
} catch (e) {
  console.error(`e2e FAILED: ${(e as Error).stack ?? e}`);
  try { console.error('--- services.log (tail) ---\n' + readFileSync(svcLog, 'utf8').split('\n').slice(-60).join('\n')); } catch {}
  process.exitCode = 1;
} finally {
  cleanup();
  process.exit();
}
