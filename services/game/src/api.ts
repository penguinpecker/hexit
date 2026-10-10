// API (DECISIONS.md, SPEC-MONAD §5.3, app/src/chain.ts): config, the SSE /stream of ticks + signed quotes + game events,
// the relayer (onboard grant, bets, withdrawals, deposits: checked locally, simulated, then sent by the relayer key, so
// players need 0 MON and a predictable revert is never paid for), transaction status, player and leaderboard reads,
// the Postgres history and the activity feed (GET /activity, SSE event "activity"). JSON bodies; uint64 fields as
// decimal strings. CORS for the web origin(s) and localhost.
// Several markets at once (BTC/USD 1, MON/USD 3): every stream message, bet and tape names its asset; one credit
// balance serves them all, so /player and the leaderboard are per wallet, not per market.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { encodeFunctionData, getAddress, isAddress, recoverTypedDataAddress, zeroAddress, type Address, type Client, type Hex } from 'viem';
import { getBalance, multicall, readContract } from 'viem/actions';
import {
  betTypedData, depositForData, depositTypedData, gameDomain, hexitGameAbi, placeBetForData, quoteTypedData, testUsdcAbi,
  tLo, usdcDomain, withdrawForData, withdrawTypedData, EXPLORER, GAS, type Deployment,
} from '@hexit/monad';
import { history, periodPnl, recentGrants, recordGrant, transfers, type Db } from './db.ts';
import { pickLimit, type Sender, type TxStatus } from './sender.ts';
import { colKey } from './indexer.ts';
import type { SignedTape } from './keeper.ts';
import type { TickRing } from './tape.ts';
import type { QuoteMsg } from './quoter.ts';
import type { ActivityRing } from './activity.ts';

/** A served market. main.ts keeps rowE8, maxMoveE8 and enabled current (HexitGame.markets(asset), then MarketSet) and
 *  quotes the newest signed board. symbol 'BTC/USD'; decimals: the price digits the app shows. */
export type Market = { asset: number; symbol: string; name: string; decimals: number; rowE8: bigint; maxMoveE8: bigint;
  enabled: boolean; ring: TickRing; quotes: QuoteMsg | null };

const GRANT = 100_000_000n;
const PERIOD_H = { daily: 24, weekly: 168 } as const;
const BET_LIMITS = [GAS.placeBetForWarmAccessList, GAS.placeBetForWarm, GAS.placeBetForOpenColumn, GAS.placeBetFor];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const U64 = (1n << 64n) - 1n, I64 = (1n << 63n) - 1n;   // I64: a row is a positive int64
const MAX_SSE = 2000;   // ponytail: one process fans out ~80 KB/s per stream of both markets; more streams need a second fan-out
const SSE_PER_IP = 20, READS_PER_IP = 10;   // streams held and /player reads per second per IP (a carrier NAT shares one IP)
// Monad charges a revert its whole gas limit, so the relayer sends only what will land as simulated (security review H2):
const LAND_MS = 600;            // a relayed transaction is in a block this soon (sendRawTransactionSync answers at Proposed)
const HOLD_MS = 2000;           // a landed debit still counts this long, in case the read RPC is a block behind
const STRIKES = 3, STRIKE_MS = 600_000;   // paid reverts per player or IP before its relays stop for the rest of the window
const GRANT_FLOOR = 500_000_000_000_000_000n;   // 0.5 MON: grants stop below it, so bets and withdrawals keep going
const PLAY_FLOOR = 250_000_000_000_000_000n;    // 0.25 MON: bets and deposits stop below it; withdrawals never do (~15 left)

/** A refusal: 400 (429 for the rate and faucet limits) with this message (a contract error name where there is one) and
 *  `extra` in the body. counted: already in /health rejects (a simulation's revert); every other refusal of a POST is
 *  counted where it is answered. */
class Bad extends Error { extra?: Record<string, unknown>; counted?: boolean }
function bad(m: string, extra?: Record<string, unknown>, counted?: boolean): never { throw Object.assign(new Bad(m), { extra, counted }); }
const LIMITS = new Set(['RateLimited', 'FaucetLimit', 'FaucetEmpty']);
const isName = (s: string) => /^[A-Z][A-Za-z0-9]+$/.test(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bits = (x: number) => { let n = 0; for (; x; x &= x - 1) n++; return n; };

/** HexitGame._placeBet's time checks at the latest whole second a bet sent now may land in (nowMs + LAND_MS): the
 *  error the chain would revert with there, or null. Refused here it costs nothing; sent, the relayer pays the limit. */
export function lateCheck(nowMs: number, b: { k: number; deadline: bigint }, q: { refTsMs: bigint; expiresMs: bigint }, maxAgeMs: number, marginMs: number) {
  const t = Math.floor((nowMs + LAND_MS) / 1000), tMs = t * 1000, ref = Number(q.refTsMs);
  if (b.deadline < BigInt(t)) return 'Expired';
  if (ref + maxAgeMs < tMs || Number(q.expiresMs) < tMs) return 'QuoteStale';
  if (tLo(b.k) < Math.max(ref, tMs) + 5100 + marginMs) return 'Locked';
  return null;
}

const uint = (v: unknown, max: bigint, what: string) => {
  const s = String(v ?? '');
  if (!/^\d{1,20}$/.test(s) || BigInt(s) > max) bad(`bad ${what}`);
  return BigInt(s);
};
const int = (v: unknown, lo: number, hi: number, what: string) => {
  const n = typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < lo || n > hi) bad(`bad ${what}`);
  return n as number;
};
const addr = (v: unknown, what = 'address'): Address => (typeof v === 'string' && isAddress(v, { strict: false }) ? getAddress(v) : bad(`bad ${what}`));
const sig65 = (v: unknown, what = 'sig'): Hex => (typeof v === 'string' && /^0x[0-9a-fA-F]{130}$/.test(v) ? v as Hex : bad(`bad ${what}`));
const hex32 = (v: unknown, what: string): Hex => (typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) ? v as Hex : bad(`bad ${what}`));

/** One playerOf slot's 128 bits: k u32 | j i32 << 32 | stake u32 << 64 | mult u16 << 96 | asset u8 << 112 (0 before the
 *  markets upgrade: SOL). */
export function openBets(openMask: number, words: readonly bigint[]) {
  const out: { slot: number; asset: number; k: number; j: number; stake: string; mult: number }[] = [];
  for (let i = 0; i < 32; i++) {
    if (!((openMask >>> i) & 1)) continue;
    const rec = (words[i >> 1] >> BigInt(128 * (i & 1))) & ((1n << 128n) - 1n);
    out.push({ slot: i, asset: Number((rec >> 112n) & 0xffn), k: Number(rec & 0xffffffffn), j: Number(BigInt.asIntN(32, rec >> 32n)),
      stake: String((rec >> 64n) & 0xffffffffn), mult: Number((rec >> 96n) & 0xffffn) });
  }
  return out;
}

/** tapes and decided are keyed by colKey(asset, k). */
export function startApi(o: { d: Deployment; read: Client; relayer: Sender; txs: Map<Hex, TxStatus>; granted: () => ReadonlySet<string>;
  tapes: ReadonlyMap<number, SignedTape>; decided: () => ReadonlySet<number>; markets: readonly Market[]; db: Db | null; activity: ActivityRing;
  health: () => object; log: (cls: string, msg: string) => void; reject: (key: string) => void; port: number; host: string; origins: string[] }) {
  const { d, read, relayer, db, log } = o, dom = gameDomain(d.game, d.chainId), udom = usdcDomain(d.usdc, d.chainId);
  const minStake = BigInt(d.params.minStake), maxStake = BigInt(d.params.maxStake), origins = new Set(o.origins);
  const byAsset = new Map(o.markets.map((m) => [m.asset, m]));

  // ---------------------------------------------------------------- reads (Multicall3 where the chain has it)
  type Call = { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] };
  const reads = (calls: Call[]): Promise<unknown[]> => read.chain?.contracts?.multicall3
    ? multicall(read, { contracts: calls as never, allowFailure: false, batchSize: 0 }) as Promise<unknown[]>
    : Promise.all(calls.map((c) => readContract(read, c as never)));
  const playerCall = (p: Address): Call => ({ address: d.game, abi: hexitGameAbi, functionName: 'playerOf', args: [p] });
  const walletCall = (p: Address): Call => ({ address: d.usdc, abi: testUsdcAbi, functionName: 'balanceOf', args: [p] });
  type PlayerOf = readonly [bigint, bigint, number, number, number, boolean, readonly bigint[]];

  const cache = new Map<string, { at: number; body?: unknown }>();
  const cached = async (key: string, ms: number, f: () => Promise<unknown>) => {
    const c = cache.get(key);
    if (c && 'body' in c && Date.now() - c.at < ms) return c.body;
    const at = Date.now(), body = await f();
    if ((cache.get(key)?.at ?? 0) < at) cache.set(key, { at, body });   // a read begun before forget() is not cached
    return body;
  };
  /** The owner's balances just changed: the next /player reads fresh, even if a read is already in flight. */
  const forget = (owner: string) => cache.set(`p:${owner.toLowerCase()}`, { at: Date.now() });

  async function player(p: Address) {
    const [pl, wallet, permitNonce] = await reads([playerCall(p), walletCall(p),
      { address: d.usdc, abi: testUsdcAbi, functionName: 'nonces', args: [p] }]) as [PlayerOf, bigint, bigint];
    const [credit, openStake, nonceBase, nonceMask, openMask, granted, words] = pl, total = wallet + credit + openStake;
    return { wallet: String(wallet), credit: String(credit), openStake: String(openStake), total: String(total), pnl: String(total - GRANT),
      nonceBase: Number(nonceBase), nonceMask, openMask, granted, permitNonce: String(permitNonce), bets: openBets(openMask, words) };
  }

  /** All time: every granted owner, total = wallet + credit + openStake (on-chain now), pnl = total - 100 USDC. */
  async function leaderboard() {
    const owners = [...o.granted()].map((x) => getAddress(x)), rows: { owner: Address; handle: string; total: bigint; pnl: bigint }[] = [];
    for (let i = 0; i < owners.length; i += 200) {
      const chunk = owners.slice(i, i + 200), r = await reads(chunk.flatMap((p) => [playerCall(p), walletCall(p)]));
      chunk.forEach((owner, n) => {
        const pl = r[2 * n] as PlayerOf, total = (r[2 * n + 1] as bigint) + pl[0] + pl[1];
        rows.push({ owner, handle: `${owner.slice(0, 6)}…${owner.slice(-4)}`, total, pnl: total - GRANT });
      });
    }
    rows.sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
    return { rows: rows.map((r) => ({ ...r, total: String(r.total), pnl: String(r.pnl) })), updatedAt: Date.now(), period: 'all' };
  }
  const allTime = () => cached('lb', 10_000, leaderboard) as ReturnType<typeof leaderboard>;
  /** Daily/weekly: P&L of bets settled in the rolling window (Postgres); without a database, the all-time rows. */
  async function periodBoard(period: keyof typeof PERIOD_H) {
    const all = await allTime(), pnl = db ? await periodPnl(db, PERIOD_H[period]).catch(() => null) : null;
    if (!pnl) return all;
    const totals = new Map(all.rows.map((r) => [r.owner.toLowerCase(), r.total]));
    return { rows: pnl.map((r) => { const owner = getAddress(r.owner);
      return { owner, handle: `${owner.slice(0, 6)}…${owner.slice(-4)}`, total: totals.get(r.owner) ?? '0', pnl: r.pnl }; }), updatedAt: Date.now(), period };
  }

  // ---------------------------------------------------------------- relayer
  // faucet: at most 3 grants per IP and 60 in total per rolling hour (seeded from Postgres once, never awaited)
  const grantsAt: { ip: string; at: number }[] = [], startedAt = Date.now(), granting = new Map<string, Hex>();
  let seeded = !db;
  const seed = () => { if (seeded) return; seeded = true;
    recentGrants(db!).then((g) => void grantsAt.unshift(...g.filter((x) => x.at < startedAt)), () => { seeded = false; }); };
  seed();
  /** 0, or the seconds until this IP may be granted again (its oldest grant, or the oldest of all, leaves the hour). */
  const grantWait = (ip: string) => { seed(); const now = Date.now(); while (grantsAt.length && now - grantsAt[0].at > 3_600_000) grantsAt.shift();
    const mine = grantsAt.filter((g) => g.ip === ip), first = mine.length >= 3 ? mine[0] : grantsAt.length >= 60 ? grantsAt[0] : null;
    return first ? Math.max(1, Math.ceil((first.at + 3_600_000 - now) / 1000)) : 0; };
  let onboarding = Promise.resolve();   // one /onboard at a time: one grant per owner, even under concurrency

  // N requests per second per key (player, IP): 5 on the paid routes, READS_PER_IP on /player
  const hits = new Map<string, { s: number; n: number }>();
  const limited = (max: number, ...keys: string[]) => keys.some((key) => {
    const s = Math.floor(Date.now() / 1000), h = hits.get(key);
    if (!h || h.s !== s) { hits.set(key, { s, n: 1 }); return false; }
    return ++h.n > max;
  });

  // Each player's relayed transactions still in flight, or landed less than HOLD_MS ago (until = when it stops counting).
  // The simulation runs against the chain as it is, so it cannot see these: two bets that each fit the credit both pass
  // it, and the second reverts on chain, paid (E2E #1). Their debits are held against the credit read now instead.
  type Pending = { nonce: bigint; debit: bigint; kind: string; until: number };
  const pend = new Map<string, Pending[]>();
  const live = (key: string) => { const now = Date.now(), l = (pend.get(key) ?? []).filter((e) => e.until > now);
    if (l.length) pend.set(key, l); else pend.delete(key); return l; };
  const strikes = new Map<string, number[]>();   // paid reverts per player and per IP
  const recent = (key: string) => (strikes.get(key) ?? []).filter((t) => t > Date.now() - STRIKE_MS);
  const monAtLeast = (wei: bigint) => (cached('mon', 2000, () => getBalance(relayer.client, { address: relayer.address })) as Promise<bigint>)
    .then((b) => b >= wei, () => true);   // a failed read never stops play: the simulation is still the gate

  /** Simulate, pick the GAS.md limit that covers it, send; {hash} at once, the outcome later at /tx/:hash. The player's
   *  cached /player is dropped now and again when it lands, so the read after "confirmed" is fresh. Refused before the
   *  simulation: a nonce already in flight, a second deposit in flight, a debit past the credit left after the debits in
   *  flight, a bet past maxOpen counting those in flight, a player or IP with STRIKES paid reverts in STRIKE_MS. */
  async function relay(kind: string, player: Address, data: Hex, limits: readonly bigint[],
    x: { nonce?: bigint; debit?: bigint; ip?: string; recheck?: () => void } = {}) {
    const key = player.toLowerCase(), others = live(key);
    const me: Pending = { nonce: x.nonce ?? -1n, debit: x.debit ?? 0n, kind, until: Infinity };
    if (x.nonce !== undefined) {
      if (others.some((e) => e.nonce === x.nonce)) bad('NonceUsed');
      if (kind === 'deposit' && others.some((e) => e.kind === 'deposit')) bad('RateLimited');   // one permit nonce, one wallet balance
      pend.set(key, [...others, me]);   // before any await: a concurrent request of this player sees it
    }
    try {
      if (x.ip && (recent(key).length >= STRIKES || recent(x.ip).length >= STRIKES)) bad('RateLimited');
      if (me.debit && others.some((e) => e.debit)) {
        const pl = await readContract(relayer.client, { address: d.game, abi: hexitGameAbi, functionName: 'playerOf', args: [player] });
        if (pl[0] < others.reduce((a, e) => a + e.debit, me.debit)) bad('InsufficientCredit');
        if (kind === 'bet' && bits(pl[4]) + others.filter((e) => e.kind === 'bet').length >= d.params.maxOpen) bad('TooManyOpen');
      }
      let sim = await relayer.simulate(data, limits.at(-1)!);
      // the newest block may still carry the previous second, so a quote ticked since looks to be from the future (E2E #3)
      if (!sim.ok && sim.error === 'QuoteStale' && x.recheck) { await sleep(450); x.recheck(); sim = await relayer.simulate(data, limits.at(-1)!); }
      if (!sim.ok) { o.reject(`${kind}:${sim.error}`); bad(sim.error, undefined, true); }
      const gas = pickLimit(sim.gasUsed, limits) ?? bad(`gas ${sim.gasUsed} over the ${kind} limit`);
      const { hash, landed } = await relayer.submit(kind, data, gas, sim.accessList);
      forget(player);
      void landed.then((s) => {
        forget(player);
        me.until = Date.now() + HOLD_MS;
        if (s.receipt && s.receipt.status !== 'success' && x.ip) for (const k of [key, x.ip]) strikes.set(k, [...recent(k), Date.now()]);
      });
      return { hash, status: 'pending' };
    } catch (e) { me.until = 0; throw e; }
  }
  /** Signed deadline (seconds): still good in the second the transaction may land in, and at most an hour out. */
  const deadlineOk = (deadline: bigint) => { const t = BigInt(Math.floor((Date.now() + LAND_MS) / 1000));
    if (deadline < t) bad('Expired'); if (deadline > t + 3600n) bad('bad deadline'); };

  async function onboard(owner: Address, ip: string) {
    const pending = granting.get(owner.toLowerCase());   // a grant still in flight: the same hash, not a second grant
    if (pending && o.txs.get(pending)?.status === 'pending') return { hash: pending, status: 'pending' };
    const [pl] = await reads([playerCall(owner)]) as [PlayerOf];
    if (pl[5]) return { done: true };
    const wait = grantWait(ip);
    if (wait) bad('FaucetLimit', { retryAfterS: wait });   // the app says when, and lets the player watch the board meanwhile
    if (!(await monAtLeast(GRANT_FLOOR))) bad('FaucetEmpty');   // the relayer is low on MON: no time to promise
    const data = encodeFunctionData({ abi: hexitGameAbi, functionName: 'grant', args: [owner] });
    let r: { hash: Hex; status: string };
    try { r = await relay('faucet', owner, data, [GAS.grant]); }
    catch (e) { if ((e as Error).message === 'AlreadyGranted') return { done: true }; throw e; }
    grantsAt.push({ ip, at: Date.now() });
    granting.set(owner.toLowerCase(), r.hash);
    setTimeout(() => granting.delete(owner.toLowerCase()), 60_000);
    if (db) recordGrant(db, owner.toLowerCase(), ip, r.hash).catch((e) => log('db-error', `grant: ${(e as Error).message}`));
    log('faucet', `grant ${owner} ${r.hash}`);
    return r;
  }

  async function bet(b: any, ip: string) {
    const bet = { player: addr(b?.bet?.player, 'player'), asset: int(b?.bet?.asset, 0, 255, 'asset'), k: int(b?.bet?.k, 0, 2 ** 32 - 1, 'k'),
      j: int(b?.bet?.j, -(2 ** 31), 2 ** 31 - 1, 'j'), stake: uint(b?.bet?.stake, U64, 'stake'), minMult: int(b?.bet?.minMult, 0, 65535, 'minMult'),
      nonce: uint(b?.bet?.nonce, U64, 'nonce'), deadline: uint(b?.bet?.deadline, U64, 'deadline') };
    const quote = { asset: int(b?.quote?.asset, 0, 255, 'quote.asset'), rowE8: uint(b?.quote?.rowE8, I64, 'quote.rowE8'), k: int(b?.quote?.k, 0, 2 ** 32 - 1, 'quote.k'),
      qJ0: int(b?.quote?.qJ0, -(2 ** 31), 2 ** 31 - 1, 'quote.qJ0'), refTsMs: uint(b?.quote?.refTsMs, U64, 'refTsMs'),
      refPriceE8: uint(b?.quote?.refPriceE8, U64, 'refPriceE8'), expiresMs: uint(b?.quote?.expiresMs, U64, 'expiresMs') };
    const sig = sig65(b?.sig), quoteSig = sig65(b?.quoteSig ?? b?.qsig, 'quoteSig');
    const mults = Array.isArray(b?.mults) && b.mults.length === 64 ? b.mults.map((m: unknown) => int(m, 0, 65535, 'mults')) : bad('bad mults');
    if (limited(5, `bet:${bet.player}`, `ip:${ip}`)) bad('RateLimited');
    // local checks first (free), then the simulation (the real gate)
    const late = () => { const e = lateCheck(Date.now(), bet, quote, d.params.quoteMaxAgeMs, d.params.lockMarginMs); if (e) bad(e); };
    late();
    if (bet.stake < minStake || bet.stake > maxStake) bad('StakeOutOfRange');
    const m = byAsset.get(bet.asset) ?? bad('MarketClosed');   // not served here (SOL, 0, takes no bets since the upgrade)
    if (quote.rowE8 !== m.rowE8) bad('QuoteStale');   // priced at another band height: the chain refuses it (security review M1)
    // SPEC-MONAD I12 drift, which left the chain with the tape (security review M1): the quote's price within a quarter band
    // (SPEC-MONAD §3.3 maxDriftE8 = row/4) of the market's live index, so nobody picks the stalest valid quote after the
    // price has moved. The chain checks that the quote is this market's (NotQuoted).
    const last = m.ring.last(), maxDrift = m.rowE8 / 4n;
    if (!last || last.ts < Date.now() - 1500 || (last.px > quote.refPriceE8 ? last.px - quote.refPriceE8 : quote.refPriceE8 - last.px) > maxDrift) bad('QuoteStale');
    if ((await recoverTypedDataAddress({ ...betTypedData(dom, bet), signature: sig })) !== bet.player) bad('BadSig');
    if ((await recoverTypedDataAddress({ ...quoteTypedData(dom, quote, mults), signature: quoteSig })) !== d.roles.quoter) bad('NotQuoter');
    if (!(await monAtLeast(PLAY_FLOOR))) { o.reject('bet:RelayerLow'); bad('IsPaused', undefined, true); }
    return relay('bet', bet.player, placeBetForData(bet, sig, quote, mults, quoteSig), BET_LIMITS, { nonce: bet.nonce, debit: bet.stake, ip, recheck: late });
  }

  async function withdraw(b: any, ip: string) {
    const w = { player: addr(b?.player, 'player'), amount: uint(b?.amount, U64, 'amount'), nonce: uint(b?.nonce, U64, 'nonce'), deadline: uint(b?.deadline, U64, 'deadline') };
    const sig = sig65(b?.sig);
    if (limited(5, `bet:${w.player}`, `ip:${ip}`)) bad('RateLimited');
    deadlineOk(w.deadline);
    if (w.amount === 0n) bad('InsufficientCredit');
    if ((await recoverTypedDataAddress({ ...withdrawTypedData(dom, w), signature: sig })) !== w.player) bad('BadSig');
    return relay('withdraw', w.player, withdrawForData(w, sig), [GAS.withdrawFor], { nonce: w.nonce, debit: w.amount, ip });
  }

  async function deposit(b: any, ip: string) {
    const dep = { player: addr(b?.player, 'player'), amount: uint(b?.amount, U64, 'amount'), nonce: uint(b?.nonce, U64, 'nonce'), deadline: uint(b?.deadline, U64, 'deadline') };
    const s = { sig: sig65(b?.sig), v: int(b?.v, 27, 28, 'v'), r: hex32(b?.r, 'r'), s: hex32(b?.s, 's') };
    if (limited(5, `bet:${dep.player}`, `ip:${ip}`)) bad('RateLimited');
    deadlineOk(dep.deadline);
    if ((await recoverTypedDataAddress({ ...depositTypedData(dom, dep), signature: s.sig })) !== dep.player) bad('BadSig');
    if (!(await monAtLeast(PLAY_FLOOR))) { o.reject('deposit:RelayerLow'); bad('IsPaused', undefined, true); }
    return relay('deposit', dep.player, depositForData(dep, s), [GAS.depositFor], { nonce: dep.nonce, ip });
  }

  const config = () => ({
    chainId: d.chainId, game: d.game, usdc: d.usdc, quoter: d.roles.quoter, recorder: d.roles.recorder, relayer: d.roles.relayer,
    explorer: d.chainId === 10143 ? EXPLORER : null, rpc: d.rpc.http, domain: dom, usdcDomain: udom, deployBlock: d.deployBlock,
    markets: o.markets.map((m) => ({ asset: m.asset, symbol: m.symbol, name: m.name, decimals: m.decimals, rowE8: String(m.rowE8),
      maxMoveE8: String(m.maxMoveE8), enabled: m.enabled })),
    minStake: d.params.minStake, maxStake: d.params.maxStake, maxPayout: d.params.maxPayout,
    maxOpen: d.params.maxOpen, lockMarginMs: d.params.lockMarginMs, quoteMaxAgeMs: d.params.quoteMaxAgeMs, voidAfterMs: d.params.voidAfterMs,
    gapMs: d.params.gapMs, betDeadlineS: 10, startGrant: d.params.grant,
  });

  // ---------------------------------------------------------------- SSE /stream (?asset=1 or ?asset=1,3: those markets only)
  // Unnamed events carry {t: ...}; the activity feed is the named event "activity" (activity.ts), its newest 30 sent on
  // connect with backfill: true, newest last.
  const clients = new Map<ServerResponse, ReadonlySet<number> | null>(), streams = new Map<string, number>();   // streams: per IP
  const line = (m: unknown, event?: string) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(m)}\n\n`;
  // Until the feed is whole (feedReady, main.ts: the indexer's first pass and the Postgres reload are in) no item goes out
  // live and a new stream's backfill waits: a stream opened during a restart's catch-up would otherwise never get the items
  // that catch-up and the reload add (review #3). null once whole.
  let waiting: Map<ServerResponse, () => void> | null = new Map();
  const feedReady = () => { const w = waiting; waiting = null; for (const backfill of w?.values() ?? []) backfill(); };
  /** To every /stream client that takes m's market; one that has fallen 1 MB behind is dropped (its EventSource
   *  reconnects and gets hello). */
  const broadcast = (m: { asset: number; [field: string]: unknown }, event?: string) => {
    if (event === 'activity' && waiting) return;   // the backfill at feedReady carries it
    const s = line(m, event);
    for (const [c, only] of clients) {
      if (only && !only.has(m.asset)) continue;
      if (c.writableLength > 1 << 20) { clients.delete(c); c.destroy(); } else c.write(s);
    }
  };

  const body = (req: IncomingMessage) => new Promise<any>((ok, fail) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 65_536) { fail(new Bad('body too large')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { fail(new Bad('bad JSON')); } });
  });

  const server = createServer(async (req, res: ServerResponse) => {
    const origin = req.headers.origin, allow = origins.has('*') ? '*' : origin && (origins.has(origin) || LOCAL.test(origin)) ? origin : null;
    if (allow) { res.setHeader('Access-Control-Allow-Origin', allow); res.setHeader('Vary', 'Origin'); }
    const send = (code: number, b: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '7200', 'Access-Control-Allow-Private-Network': 'true' });
      return void res.end();
    }
    const [path, query] = (req.url ?? '/').split('?'), qs = new URLSearchParams(query);
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',').pop()!.trim();   // the proxy appends the real client IP last
    try {
      if (req.method === 'GET') {
        if (path === '/config') return send(200, config());
        if (path === '/health') return send(200, { ...o.health(), sse: clients.size });
        if (path === '/activity') { const n = parseInt(qs.get('limit') ?? '', 10);   // 30 when absent; 0 is 1, not the default
          return send(200, { items: o.activity.latest(Math.min(Math.max(Number.isNaN(n) ? 30 : n, 1), 100)) }); }
        if (path === '/stream') {
          const want = qs.get('asset'), only = want === null ? null : new Set(want.split(',').map((x) => int(x, 0, 255, 'asset')));
          if (only && [...only].some((a) => !byAsset.has(a))) bad('bad asset');
          if (clients.size >= MAX_SSE || (streams.get(ip) ?? 0) >= SSE_PER_IP) return send(503, { error: 'too many streams' });
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write('retry: 2000\n\n');
          for (const m of o.markets) if (!only || only.has(m.asset))   // one hello per market: its last minute of ticks and its newest board
            res.write(line({ t: 'hello', asset: m.asset, ticks: m.ring.since(Date.now() - 60_000).map((t) => [t.ts, String(t.px)]), quotes: m.quotes }));
          const backfill = () => { for (const a of o.activity.latest(30, only).reverse()) res.write(line({ ...a, backfill: true }, 'activity')); };
          if (waiting) waiting.set(res, backfill); else backfill();
          clients.set(res, only);
          streams.set(ip, (streams.get(ip) ?? 0) + 1);
          return void req.on('close', () => { clients.delete(res); waiting?.delete(res); const n = (streams.get(ip) ?? 1) - 1; if (n > 0) streams.set(ip, n); else streams.delete(ip); });
        }
        // a column's signed tape only once the column is decided on chain: served earlier, it would let a MON holder
        // settle the columns they won and let the rest VOID (security review H1, L2)
        let m = /^\/tape\/(\d{1,3})\/(\d{1,10})$/.exec(path);
        if (m) {
          const col = colKey(Number(m[1]), Number(m[2])), t = o.decided().has(col) ? o.tapes.get(col) : undefined;
          return t ? send(200, { asset: t.asset, k: t.k, ts: t.ts.map(String), px: t.px.map(String), sig: t.sig }) : send(404, { error: 'no tape for this column' });
        }
        if ((m = /^\/tx\/(0x[0-9a-fA-F]{64})$/.exec(path))) {
          const s = o.txs.get(m[1].toLowerCase() as Hex);
          return s ? send(200, { ...s, errName: s.error && isName(s.error) ? s.error : undefined }) : send(404, { error: 'unknown transaction' });
        }
        if (path === '/leaderboard') {
          const period = qs.get('period');
          return send(200, period === 'daily' || period === 'weekly' ? await cached(`lb:${period}`, 10_000, () => periodBoard(period)) : await allTime());
        }
        if ((m = /^\/player\/([^/]+)\/(history|transfers)$/.exec(path))) {
          const owner = addr(decodeURIComponent(m[1])).toLowerCase(), limit = Math.min(Math.max(parseInt(qs.get('limit') ?? '', 10) || 50, 1), 200);
          // no database, or it fails: as without one (never its error text)
          const [none, run] = m[2] === 'history' ? [{ bets: [], stats: null }, () => history(db!, owner, limit)]
            : [{ transfers: [] }, async () => ({ transfers: await transfers(db!, owner, limit) })];
          return send(200, db ? await run().catch((e) => (log('db-error', `${m![2]}: ${(e as Error).message}`), none)) : none);
        }
        if ((m = /^\/player\/([^/]+)$/.exec(path))) {
          const p = addr(decodeURIComponent(m[1]));
          if (limited(READS_PER_IP, `read:${ip}`)) bad('RateLimited');   // each uncached read is an RPC call (security review M3)
          return send(200, await cached(`p:${p.toLowerCase()}`, 1000, () => player(p)));
        }
      }
      if (req.method === 'POST') {
        if (path === '/onboard') {
          const b = await body(req), owner = addr(b.owner ?? b.player, 'owner');
          if (owner === zeroAddress) bad('bad owner');
          const run = onboarding.then(() => onboard(owner, ip));
          onboarding = run.then(() => {}, () => {});
          return send(200, await run);
        }
        if (path === '/bet') return send(200, await bet(await body(req), ip));
        if (path === '/withdraw') return send(200, await withdraw(await body(req), ip));
        if (path === '/deposit') return send(200, await deposit(await body(req), ip));
      }
      send(404, { error: 'not found' });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (e instanceof Bad) {
        if (req.method === 'POST' && !e.counted) o.reject(`${path === '/onboard' ? 'faucet' : path.slice(1)}:${msg}`);   // refused before any simulation
        return send(LIMITS.has(msg) ? 429 : 400, { error: msg, errName: isName(msg) ? msg : undefined, ...e.extra });
      }
      log('api-error', `${req.method} ${path}: ${msg}`.slice(0, 200));
      send(500, { error: 'internal error' });
    }
  });
  server.listen(o.port, o.host);
  const prune = setInterval(() => { const s = Math.floor(Date.now() / 1000); for (const [k, h] of hits) if (h.s < s - 1) hits.delete(k);
    for (const k of pend.keys()) live(k);
    for (const k of strikes.keys()) { const l = recent(k); if (l.length) strikes.set(k, l); else strikes.delete(k); } }, 10_000);

  return {
    broadcast, forget, feedReady, clients: () => clients.size, server,
    stop: () => { clearInterval(prune); for (const c of clients.keys()) c.destroy(); server.close(); },
  };
}
