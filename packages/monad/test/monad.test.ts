// Runs against the built dist (npm test builds first). The anvil test needs Foundry >= 1.8.5 on PATH and a built
// contracts/out (cd contracts && forge build). It deploys with contracts/script/Deploy.s.sol inside a throwaway clone
// of contracts/, so nothing is written to the repo, and it never touches a public network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { constants, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import {
  createPublicClient, createTestClient, createWalletClient, defineChain, encodeAbiParameters, encodeEventTopics, encodeFunctionData,
  hashTypedData, http, recoverTypedDataAddress, type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import * as m from '../dist/index.js';

// contracts/README.md test vectors (forge asserts the same digests against the contract).
const mults = Array.from({ length: 64 }, (_, i) => 150 + 10 * (i % 32));
const vts = [1790000009100n, 1790000009200n, 1790000009300n];
const vpx = [12002250000n, 12002350000n, 12002150000n];
const MULTS_HASH = '0xa4d69d8a1e217af491f513e94e73c7175c058e97d6b2262c193ea798c5dc3f6c';

test('typed data reproduces the contracts/README.md EIP-712 vectors (markets: asset 3)', () => {
  const dom = m.gameDomain('0x00000000000000000000000000000000000000aa', 10143);
  assert.equal(m.multsHash(mults), MULTS_HASH);
  assert.equal(m.ticksHash(vts, vpx), '0xe640a17873080e8f02b1c91295921b89cad701afdf7fec245c91bc05cb40b962');
  const q = { asset: 3, rowE8: 2000n, k: 358000002, qJ0: -5, refTsMs: 1790000003000n, refPriceE8: 12002250000n, expiresMs: 1790000004500n };
  assert.equal(hashTypedData(m.quoteTypedData(dom, q, mults)), '0x18924f36958f3ea4139f035437e8c8ca512d9220bbce1c8bfa5afffae2d628e6');
  const bet = { player: '0x00000000000000000000000000000000000000bb', asset: 3, k: 358000002, j: -7, stake: 1000000n, minMult: 101, nonce: 3n, deadline: 1790000010n } as const;
  assert.equal(hashTypedData(m.betTypedData(dom, bet)), '0x779f6fb72275e794ea542c432eadc29a97ba02278f4937a9a8e9cbfcb45afa87');
  assert.equal(hashTypedData(m.tapeTypedData(dom, 3, 358000002, vts, vpx)), '0xa0404638e9aeb3199199acb8d1c0771a54c816a4972386dfe2246c8a9e41def2');
  // the asset is signed: the same message on another market is another digest
  assert.notEqual(hashTypedData(m.betTypedData(dom, { ...bet, asset: 1 })), hashTypedData(m.betTypedData(dom, bet)));
  assert.throws(() => m.multsHash(mults.slice(1)));
  assert.throws(() => m.multsHash([...mults.slice(1), 70000]));
  assert.equal(m.txUrl('0xab'), 'https://testnet.monadvision.com/tx/0xab');
});

test('decodeGameLogs: current events keep their asset; pre-markets events (other topic0) decode as asset 0', () => {
  const game = '0x00000000000000000000000000000000000000aa', player = '0x00000000000000000000000000000000000000bb';
  const log = (abi: readonly any[], eventName: string, args: Record<string, unknown>, address: Hex = game) => {
    const ev = abi.find((x) => x.type === 'event' && x.name === eventName);
    const plain = ev.inputs.filter((i: any) => !i.indexed);
    return { address, blockNumber: 7n, blockHash: '0x' + '11'.repeat(32), transactionHash: '0x' + '22'.repeat(32), logIndex: 0,
      transactionIndex: 0, removed: false, topics: encodeEventTopics({ abi: [ev], eventName, args } as never),
      data: encodeAbiParameters(plain, plain.map((i: any) => args[i.name])) } as never;
  };
  const placed = { player, k: 358000002, j: -7, stake: 1_000_000n, mult: 150, nonce: 3n, slot: 2 };
  const settled = { player, k: 358000002, j: -7, stake: 1_000_000n, mult: 150, slot: 2, outcome: 1, credited: 1_500_000n };
  const logs = [
    log(m.legacyGameEvents, 'BetPlaced', placed), log(m.legacyGameEvents, 'BetSettled', settled),
    log(m.legacyGameEvents, 'HexTouched', { k: 358000002, j: -7, tsMs: 1790000012300n }),
    log(m.legacyGameEvents, 'ColumnSettled', { k: 358000002, bJ0: -135, gap: false, touched: 1n << 128n }),
    log(m.legacyGameEvents, 'ColumnVoided', { k: 358000003 }),
    log(m.hexitGameAbi, 'BetPlaced', { ...placed, asset: 3 }), log(m.hexitGameAbi, 'ColumnVoided', { asset: 1, k: 358000004 }),
    log(m.hexitGameAbi, 'Granted', { player, amount: 100_000_000n }),
    log(m.hexitGameAbi, 'Granted', { player, amount: 1n }, '0x00000000000000000000000000000000000000cc'),   // another contract
  ];
  const out = m.decodeGameLogs(logs, game);
  assert.deepEqual(out.map((e) => [e.eventName, (e.args as any).asset]), [['BetPlaced', 0], ['BetSettled', 0], ['HexTouched', 0],
    ['ColumnSettled', 0], ['ColumnVoided', 0], ['BetPlaced', 3], ['ColumnVoided', 1], ['Granted', undefined]]);
  assert.deepEqual(out[0].args, { ...placed, asset: 0 });
  assert.equal((out[1].args as any).credited, 1_500_000n);
  assert.equal((out[6].args as any).k, 358000004);
  // the old and new topic0 of each bet and column event differ, so neither ABI can misread the other's logs
  for (const ev of m.legacyGameEvents) assert.notEqual(encodeEventTopics({ abi: [ev], eventName: ev.name } as never)[0],
    encodeEventTopics({ abi: m.hexitGameAbi, eventName: ev.name } as never)[0]);
});

test('esbuild bundles it for the browser, and the bundle runs with web globals only', async () => {
  const out = await build({ entryPoints: [new URL('../dist/index.js', import.meta.url).pathname], bundle: true,
    platform: 'browser', format: 'iife', globalName: 'HexitMonad', minify: true, write: false, logLevel: 'silent' });
  const code = out.outputFiles[0].text;
  // No require, process or Buffer in this context: only what a browser has.
  const lib = runInNewContext(`${code};HexitMonad`, { TextEncoder, TextDecoder, crypto });
  assert.equal(lib.multsHash(mults), MULTS_HASH);
  console.log(`browser bundle: ${(code.length / 1024).toFixed(1)} KiB minified (iife, platform=browser)`);
});

test('each struct signed here is accepted by the contracts on a local anvil --network monad', { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hexit-monad-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = new URL('../../../contracts', import.meta.url).pathname;
  const contracts = join(dir, 'contracts');
  const skip = [join(src, 'broadcast'), join(src, 'deployments')];
  cpSync(src, contracts, { recursive: true, preserveTimestamps: true, mode: constants.COPYFILE_FICLONE, filter: (p) => !skip.includes(p) });

  const port = 20000 + (process.pid % 10000);
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = spawn('anvil', ['--network', 'monad', '--port', String(port)], { stdio: 'ignore' });
  t.after(() => anvil.kill());
  let pub = createPublicClient({ transport: http(rpc) });
  for (let i = 0; ; i++) {
    try { await pub.getChainId(); break; } catch { if (i > 100) throw new Error('anvil did not start'); await new Promise((r) => setTimeout(r, 100)); }
  }

  // Unlocked anvil accounts send; recorder, quoter, player and a stranger are throwaway keys that only sign.
  const [admin, relayer, keeper, guardian] = await pub.request({ method: 'eth_accounts' }) as `0x${string}`[];
  const [recorder, quoter, player, stranger] = [0, 1, 2, 3].map(() => privateKeyToAccount(generatePrivateKey()));
  const env: Record<string, string | undefined> = { ...process.env, HEXIT_ADMIN: admin, HEXIT_RELAYER: relayer,
    HEXIT_KEEPER: keeper, HEXIT_GUARDIAN: guardian, HEXIT_RECORDER: recorder.address, HEXIT_QUOTER: quoter.address,
    HEXIT_DEPLOY_OUT: 'deployments/local.json' };
  delete env.HEXIT_KEY_ADMIN;
  execFileSync('forge', ['script', 'script/Deploy.s.sol', '--rpc-url', rpc, '--broadcast', '--unlocked', '--sender', admin,
    '--slow', '-q'], { cwd: contracts, env, stdio: 'pipe' });
  const raw = JSON.parse(readFileSync(join(contracts, 'deployments/local.json'), 'utf8'));
  const d = m.parseDeployment(raw);
  assert.throws(() => m.parseDeployment({ ...raw, game: '0x1234' }));
  assert.equal(d.roles.quoter, quoter.address);

  const chain = defineChain({ ...m.monadTestnet, id: d.chainId, rpcUrls: { default: { http: [rpc] } } });
  pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ chain, transport: http(rpc) });
  const anvilCtl = createTestClient({ chain, mode: 'anvil', transport: http(rpc) });
  const dom = m.gameDomain(d.game, d.chainId);
  const read = (functionName: string, args: unknown[] = [], address = d.game, abi: readonly unknown[] = m.hexitGameAbi) =>
    pub.readContract({ address, abi, functionName, args } as never) as Promise<any>;
  const revertName = async (from: `0x${string}`, data: `0x${string}`) => {
    try { await pub.call({ account: from, to: d.game, data }); return 'no revert'; } catch (e) { return m.errorName(e); }
  };
  const send = async (from: `0x${string}`, data: `0x${string}`, gas: bigint) => {
    const hash = await wallet.sendTransaction({ account: from, to: d.game, data, gas });
    const r = await pub.waitForTransactionReceipt({ hash });
    assert.equal(r.status, 'success', `reverted within gas limit ${gas}`);
    console.log(`gasUsed ${r.gasUsed} / limit ${gas}`);
    return m.decodeGameLogs(r.logs, d.game);
  };

  // grant (relayer)
  const granted = await send(relayer, encodeFunctionData({ abi: m.hexitGameAbi, functionName: 'grant', args: [player.address] }), m.GAS.grant);
  assert.deepEqual(granted.map((l) => l.eventName), ['Granted']);
  assert.equal(await pub.simulateContract({ address: d.game, abi: m.hexitGameAbi, functionName: 'grant', args: [player.address],
    account: relayer }).catch(m.errorName), 'AlreadyGranted');

  // Bet + Quote -> placeBetFor (relayer), on the first column the lock allows, with 2 s of slack.
  const blk = await pub.getBlock();
  const refTsMs = blk.timestamp * 1000n + 1000n;                       // valid for block times up to 2.5 s later
  const k = Math.ceil((Number(refTsMs) + 5100 + d.params.lockMarginMs + 834 + 2000) / m.COL_MS);
  assert.ok(m.tLo(k) >= Number(refTsMs) + 5100 + d.params.lockMarginMs);
  // BTC (asset 1): the band height from the chain (markets(asset) = rowE8, maxMoveE8, enabled, maxLiab, openLiab)
  const asset = 1, [rowE8, , enabled] = await read('markets', [asset]);
  assert.equal(enabled, true);
  assert.equal(String(rowE8), d.markets?.['1']?.rowE8);
  const row = BigInt(rowE8);
  const refPriceE8 = 8_238_500_000_000n;                                // $82,385
  const j = Number(refPriceE8 / row);
  const q = { asset, rowE8: row, k, qJ0: j - 32, refTsMs, refPriceE8, expiresMs: refTsMs + 60_000n };
  const bet = { player: player.address, asset, k, j, stake: 1_000_000n, minMult: mults[32], nonce: 0n, deadline: blk.timestamp + 60n };
  const sig = await m.signBet(player, dom, bet);
  const qsig = await m.signQuote(quoter, dom, q, mults);
  assert.equal(await recoverTypedDataAddress({ ...m.betTypedData(dom, bet), signature: sig }), player.address);
  assert.equal(await recoverTypedDataAddress({ ...m.quoteTypedData(dom, q, mults), signature: qsig }), quoter.address);
  assert.equal(await revertName(relayer, m.placeBetForData(bet, await m.signBet(stranger, dom, bet), q, mults, qsig)), 'BadSig');
  assert.equal(await revertName(relayer, m.placeBetForData(bet, sig, q, mults, await m.signQuote(stranger, dom, q, mults))), 'NotQuoter');
  // the quote of another market does not price this bet; SOL (0) is closed to bets
  const q3 = { ...q, asset: 3 }, b0 = { ...bet, asset: 0 }, q0 = { ...q, asset: 0 };
  assert.equal(await revertName(relayer, m.placeBetForData(bet, sig, q3, mults, await m.signQuote(quoter, dom, q3, mults))), 'NotQuoted');
  assert.equal(await revertName(relayer, m.placeBetForData(b0, await m.signBet(player, dom, b0), q0, mults, await m.signQuote(quoter, dom, q0, mults))), 'MarketClosed');
  // a quote priced at another band height (a setMarket row change since it was signed) does not price a bet
  const qr = { ...q, rowE8: row + 1n };
  assert.equal(await revertName(relayer, m.placeBetForData(bet, sig, qr, mults, await m.signQuote(quoter, dom, qr, mults))), 'QuoteStale');
  const placed = await send(relayer, m.placeBetForData(bet, sig, q, mults, qsig), m.GAS.placeBetFor);
  assert.deepEqual(placed.map((l) => l.eventName), ['BetPlaced']);
  const mult = mults[32];
  assert.deepEqual(placed[0].args, { player: player.address, asset, k, j, stake: bet.stake, mult, nonce: 0n, slot: 0 });

  // ColumnTape -> settleColumn (keeper). A flat tape through the centre of hex (k, j) (HexGeo.segHits) touches it: a WIN.
  const centre = (BigInt(2 * j + 1 + (k % 2)) * row) / 2n;
  const first = Math.floor(m.tLo(k) / 100) * 100;
  const last = Math.ceil(m.tHi(k) / 100) * 100;
  const ts = Array.from({ length: (last - first) / 100 + 1 }, (_, i) => BigInt(first + 100 * i));
  const px = ts.map(() => centre);
  await anvilCtl.setNextBlockTimestamp({ timestamp: BigInt(Math.ceil(last / 1000)) });   // the last tick is not in the future
  await anvilCtl.mine({ blocks: 1 });
  const tsig = await m.signTape(recorder, dom, asset, k, ts, px);
  assert.equal(await recoverTypedDataAddress({ ...m.tapeTypedData(dom, asset, k, ts, px), signature: tsig }), recorder.address);
  const settle = (s: `0x${string}`) => encodeFunctionData({ abi: m.hexitGameAbi, functionName: 'settleColumn', args: [asset, k, ts, px, s, [player.address]] });
  assert.equal(await revertName(keeper, settle(await m.signTape(stranger, dom, asset, k, ts, px))), 'NotRecorder');
  assert.equal(await revertName(keeper, settle(await m.signTape(recorder, dom, 3, k, ts, px))), 'NotRecorder');   // MON's tape for k
  const settled = await send(keeper, settle(tsig), m.settleColumnGas(1));
  assert.deepEqual(settled.map((l) => l.eventName), ['HexTouched', 'ColumnSettled', 'BetSettled']);
  const payout = bet.stake * BigInt(mult) / 100n;
  assert.deepEqual([settled[0].args.asset, settled[0].args.j], [asset, j]);
  assert.deepEqual([settled[2].args.outcome, settled[2].args.credited], [m.OUTCOME.WIN, payout]);

  // Withdraw -> withdrawFor (anyone; here the keeper)
  const now = (await pub.getBlock()).timestamp;
  const w = { player: player.address, amount: 5_000_000n, nonce: 1n, deadline: now + 600n };
  const wsig = await m.signWithdraw(player, dom, w);
  assert.equal(await recoverTypedDataAddress({ ...m.withdrawTypedData(dom, w), signature: wsig }), player.address);
  assert.equal(await revertName(keeper, m.withdrawForData(w, await m.signWithdraw(stranger, dom, w))), 'BadSig');
  const withdrawn = await send(keeper, m.withdrawForData(w, wsig), m.GAS.withdrawFor);
  assert.deepEqual(withdrawn.map((l) => [l.eventName, l.args.amount]), [['Withdrawn', w.amount]]);
  assert.equal(await read('balanceOf', [player.address], d.usdc, m.testUsdcAbi), w.amount);

  // Deposit + tUSDC permit -> depositFor (anyone)
  const usdcDom = m.usdcDomain(d.usdc, d.chainId);
  const dep = { player: player.address, amount: w.amount, nonce: 2n, deadline: now + 600n };
  const permitNonce = await read('nonces', [player.address], d.usdc, m.testUsdcAbi);
  const ds = await m.signDeposit(player, dom, usdcDom, dep, permitNonce);
  assert.equal(await recoverTypedDataAddress({ ...m.depositTypedData(dom, dep), signature: ds.sig }), player.address);
  const bad = await m.signDeposit(stranger, dom, usdcDom, dep, permitNonce);
  assert.equal(await revertName(keeper, m.depositForData(dep, { ...ds, sig: bad.sig })), 'BadSig');
  assert.equal(await revertName(keeper, m.depositForData(dep, { ...bad, sig: ds.sig })), 'ERC20InsufficientAllowance');
  const deposited = await send(keeper, m.depositForData(dep, ds), m.GAS.depositFor);
  assert.deepEqual(deposited.map((l) => [l.eventName, l.args.amount]), [['Deposited', dep.amount]]);
  assert.equal(await read('balanceOf', [player.address], d.usdc, m.testUsdcAbi), 0n);
  const [credit, openStake, nonceBase] = await read('playerOf', [player.address]);
  assert.deepEqual([credit, openStake, nonceBase], [100_000_000n - bet.stake + payout, 0n, 3]);
});
