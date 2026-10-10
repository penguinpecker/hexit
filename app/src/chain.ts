// Bundled by build.mjs into dist/hexit-chain.js (IIFE) as window.HexitChain. index.html's seams (a-g)
// call into it; the drawing code never touches the network.
// Monad testnet (docs/monad/DECISIONS.md): the built-in key signs EIP-712 messages on this device and the API's relayer
// sends them, so the player needs 0 MON. Ticks, quotes and events come from the API's SSE /stream; the app talks only
// to the API (no RPC host). Every transaction shows in the right-side popups (window.HexitTx, index.html).
// Several markets at once (GET /config markets: BTC/USD asset 1, MON/USD asset 3): one stream carries all of them, every
// message names its asset, and every bet signs it; the credit, the nonces and the popups are shared.
import { gameDomain, usdcDomain, signBet, signWithdraw, signDeposit } from '@hexit/monad';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';   // the same viem copy @hexit/monad bundles (build.mjs nodePaths)
import { firstOpenColumn } from '@hexit/pricing';
import { jOf, multAt, overPayout, nonceUsed, freeNonce, balanceMicro, mergeHistory, boardGeom, activityOf, feedKey, feedView, ago, type QuotedColumn } from './seams.ts';

declare const __HEXIT_API__: string;
const API = __HEXIT_API__;   // set by build.mjs from HEXIT_API (default: the Railway services; HEXIT_API=http://localhost:8788 for a local stack)
const KEY = 'hexit.monad.key';   // the only thing stored: the wallet's private key, 0x + 64 hex. Never sent anywhere, never logged.

/** GET /config (the fields this app reads). markets: rowE8 = the band height x1e8, decimals = the price digits shown. */
interface Config { chainId: number; game: `0x${string}`; usdc: `0x${string}`; maxPayout: string; lockMarginMs?: number; betDeadlineS?: number;
  markets: { asset: number; symbol: string; name: string; decimals: number; rowE8: string; enabled: boolean }[] }
/** A quote as the SSE carries it, plus exp (expiresMs as a number) for the freshness check. */
interface Quote extends QuotedColumn { qJ0: number; mults: number[]; sig: string; rowE8: string; refTsMs: string; refPriceE8: string; expiresMs: string; exp: number }
/** GET /player/:owner, as numbers. */
export interface PlayerView { credit: number; openStake: number; nonceBase: number; nonceMask: number; wallet: number;
  bets: { asset: number; k: number; j: number; stake: number; mult: number }[] }
export interface Handlers {
  onTick(asset: number, tsMs: number, price: number): void;
  onPlayer(p: PlayerView): void;
  onEvent(name: string, data: Record<string, any>): void;   // data.asset: the market
  onOther?(bet: Record<string, any>): void;   // another wallet's BetPlaced
  onRow?(asset: number, row: number): void;   // the owner changed a market's band height (setMarket): the quotes use it now
}
type Err = Error & { errName?: string; unknown?: boolean; retryAfterS?: number };   // retryAfterS: the faucet's FaucetLimit says when

let cfg: Config, dom: ReturnType<typeof gameDomain>, udom: ReturnType<typeof usdcDomain>, maxPayout = 0, deadlineS = 10;
let acct: ReturnType<typeof privateKeyToAccount> | null = null, started = false, lastTs = 0, P: PlayerView | null = null, H: Handlers | null = null;
const quotes = new Map<number, Map<number, Quote>>(), rows = new Map<number, number>(), lastOf = new Map<number, number>();   // per asset: quotes by k, band height (USD), newest tick
const base = (asset: number) => cfg?.markets.find((m) => m.asset === asset)?.symbol.split('/')[0] ?? (asset === 0 ? 'SOL' : undefined);   // 'BTC', for the popups (0: a SOL bet from before the markets upgrade)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pop = (o: Record<string, unknown>) => (globalThis as any).HexitTx?.show(o);
const act = (m: unknown) => { const a = activityOf(m); if (a) (globalThis as any).HexitTx?.feed(a); };   // the live feed: every player's real txs
const usd = (micro: number) => '$' + (micro / 1e6).toFixed(2);
const stakeStr = (micro: number) => micro < 1e6 ? usd(micro) : '$' + +(micro / 1e6).toFixed(2);   // $0.10, $1: index.html fmtStake
const tapeNow = () => lastTs || Date.now();   // the newest tick's time (any market): the server's clock, whatever this device's says
const named = (msg: string, extra: Partial<Err> = {}): Err =>
  Object.assign(new Error(msg), { errName: /^[A-Z][A-Za-z0-9]+$/.test(msg) ? msg : undefined }, extra);

/** An API call. A refusal (HTTP error or {error}) throws with .errName when the API names a contract error; no answer
 *  at all throws with .unknown (a POST may have been relayed anyway). An answer carrying a hash is returned even with an
 *  error: the transaction was sent and reverted, and its popup links to it (landed() reads the status). */
async function api(path: string, body?: unknown) {
  let r: Response;
  try {
    r = await fetch(API + path, body === undefined ? { signal: AbortSignal.timeout(8000) } : {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),   // uint64 fields go as decimal strings
    });
  } catch (e) { throw named(String((e as Error)?.message ?? e), { unknown: true }); }
  const j = await r.json().catch(() => ({}));
  if (j.hash && body !== undefined) return j;
  if (!r.ok || j.error) throw named(String(j.errName ?? j.error ?? `${path} answered HTTP ${r.status}`), Number(j.retryAfterS) > 0 ? { retryAfterS: Number(j.retryAfterS) } : {});
  return j;
}

/** GET /config: the game and tUSDC addresses, the EIP-712 domains and the markets. Throws when the API is down. */
async function init() {
  cfg = await api('/config');
  dom = gameDomain(cfg.game, cfg.chainId);
  udom = usdcDomain(cfg.usdc, cfg.chainId);
  for (const m of cfg.markets) rows.set(m.asset, Number(m.rowE8) / 1e8);
  maxPayout = Number(cfg.maxPayout);
  deadlineS = cfg.betDeadlineS ?? 10;
  return { usdc: cfg.usdc, chainId: cfg.chainId, maxPayout: maxPayout / 1e6,
    markets: cfg.markets.map((m) => ({ asset: m.asset, sym: m.symbol, name: m.name, dec: m.decimals, row: rows.get(m.asset)!, live: m.enabled })) };
}

/** The built-in test wallet: one private key in localStorage, created on first use. A stored value is used only if it
 *  is 0x + 64 hex and a valid secp256k1 key. */
function wallet() {
  if (acct) return acct;
  try {
    const k = localStorage.getItem(KEY);
    if (k && /^0x[0-9a-f]{64}$/i.test(k)) acct = privateKeyToAccount(k as `0x${string}`);
  } catch { /* storage blocked, or not a valid key */ }
  if (!acct) {
    const k = generatePrivateKey();
    acct = privateKeyToAccount(k);
    try { localStorage.setItem(KEY, k); }
    catch { console.warn('hexit: localStorage unavailable, this wallet lasts only until the page closes'); }
  }
  return acct;
}

/** Resolves once the transaction is in a block: at once when the relay's answer r already says so (it sends with
 *  eth_sendRawTransactionSync), else by polling GET /tx/:hash. Throws with .errName when it reverted, or with .unknown
 *  when there is no answer within 30 s. */
async function landed(r: { hash: string; status?: string; errName?: string; error?: string }) {
  for (let i = 0, s: any = r; i < 60; i++, await sleep(500), s = await api('/tx/' + r.hash).catch(() => null)) {
    if (s?.status === 'confirmed') return;
    if (s?.status === 'failed') throw named(String(s.errName ?? s.error ?? 'Reverted'));
  }
  throw named('No receipt after 30 s', { unknown: true });
}

// ---- the one balance: GET /player, refreshed on this wallet's events and after each of its transactions
let asked = 0, applied = 0, refreshT: ReturnType<typeof setTimeout> | undefined;
async function refresh() {
  const n = ++asked, m = await api('/player/' + wallet().address);
  if (n < applied) return P;   // an older request answered late: a newer answer is already in
  applied = n;
  P = { credit: +m.credit, openStake: +m.openStake, nonceBase: +m.nonceBase, nonceMask: +m.nonceMask, wallet: +(m.wallet ?? 0),
    bets: (m.bets ?? []).map((b: any) => ({ asset: +b.asset, k: +b.k, j: +b.j, stake: +b.stake, mult: +b.mult })) };
  H?.onPlayer(P);
  return P;
}
const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(() => refresh().catch(() => {}), 250); };   // a burst of events: one GET

// ---- nonces: lowest free in the window; a signed one is held until its deadline + 2 s unless it is refused for sure
const held = new Map<number, number>();   // nonce -> Date.now() after which it may be signed again
function takeNonce() {
  const now = Date.now(), n = freeNonce(P?.nonceBase ?? 0, P?.nonceMask ?? 0, (n) => (held.get(n) ?? 0) > now);
  if (n < 0) throw named('TooManyOpen');
  held.set(n, now + deadlineS * 1000 + 2000);
  return n;
}
const deadline = () => BigInt(Math.floor(tapeNow() / 1000) + deadlineS);

/** One relayed transaction with its popup: sign + POST (send) -> pending with the hash -> confirmed / failed. A refused
 *  request frees its nonce at once; with no answer, the chain decides (the nonce used = it landed). */
async function relay(o: { id: string; kind: string; title: string }, nonce: number, send: () => Promise<{ hash: string }>) {
  pop({ ...o, status: 'pending', detail: 'Signing', hash: '' });
  try {
    const r = await send();
    pop({ id: o.id, hash: r.hash, detail: 'Relayed' });
    await landed(r);
  } catch (e) {
    const err = e as Err;
    if (err.unknown) {
      const p = await refresh().catch(() => null);
      if (p && nonceUsed(p.nonceBase, p.nonceMask, nonce)) return void pop({ id: o.id, status: 'confirmed', detail: 'In a block' });
    } else held.delete(nonce);
    pop({ id: o.id, status: err.unknown ? 'pending' : 'failed', detail: err.errName ?? (err.unknown ? 'No answer yet' : 'Not sent') });
    throw err;
  }
  pop({ id: o.id, status: 'confirmed', detail: 'In a block' });
  refresh().catch(() => {});
}
let seq = 0;

/** (f) POST /onboard: the relayer grants $100 of tUSDC credit (popup), then the credit is read back. */
async function onboard() {
  const r = await api('/onboard', { owner: wallet().address });
  if (!r.done) {
    pop({ id: 'grant', kind: 'grant', status: 'pending', title: '$100 test USDC', detail: 'Welcome grant', hash: r.hash });
    try { await landed(r); } catch (e) { pop({ id: 'grant', status: (e as Err).unknown ? 'pending' : 'failed', detail: (e as Err).errName ?? 'Retrying' }); throw e; }
    pop({ id: 'grant', status: 'confirmed', detail: 'Credited' });
  }
  for (let i = 0; i < 20; i++, await sleep(500)) { const p = await refresh(); if (p && (p.credit > 0 || p.openStake > 0)) break; }   // the API's read may lag the block
}

/** A returning player: a key is already stored here and its grant is on chain. Never creates a wallet or calls /onboard. */
async function returning() {
  try { if (!/^0x[0-9a-f]{64}$/i.test(localStorage.getItem(KEY) ?? '')) return false; } catch { return false; }
  return !!(await api('/player/' + wallet().address)).granted;
}

/** (a) ticks, (b) quotes, (d) events, (e) the balance. Call once the wallet is onboarded. */
function start(h: Handlers) {
  if (started) return;
  started = true;
  myAddr = wallet().address.toLowerCase();
  (globalThis as any).HexitTx?.me(myAddr);   // the feed marks this wallet's entries and settles "You", and folds them into its own popups
  watch(h);
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), 10_000);   // backstop for an event lost in a reconnect
}

/** The public stream alone (ticks, quotes, other wallets' bets), no wallet needed: the desktop draws the live board behind
 *  the sign-in. start() calls it too; a second call only swaps the handlers. */
let myAddr = '', streaming = false;   // myAddr: this wallet, lowercase ('' while only watching)
function watch(h: Handlers) {
  H = h;
  if (streaming) return;
  streaming = true;
  const setQuotes = (asset: number, m: any) => {   // a market's newest signed board replaces its last one
    const qs = new Map<number, Quote>();
    for (const c of m?.cols ?? []) {
      const expiresMs = String(c.expiresMs ?? m.expiresMs);
      qs.set(+c.k, { k: +c.k, qJ0: +c.qJ0, mults: c.mults.map(Number), sig: c.sig ?? c.quoteSig, rowE8: String(m.rowE8), refTsMs: String(c.refTsMs ?? m.refTsMs),
        refPriceE8: String(c.refPriceE8 ?? m.refPriceE8), expiresMs, exp: Number(expiresMs) });
    }
    quotes.set(asset, qs);
    const r = Number(m?.rowE8) / 1e8;   // the band height these were priced at: draw with it (a setMarket row change, no reload)
    if (r > 0 && r !== rows.get(asset)) { rows.set(asset, r); H?.onRow?.(asset, r); }
  };
  const handle = (t: string, m: any) => {
    const h = H!, a = Number(m.asset);
    if (t === 'hello' || t === 'ticks') for (const [ts, p] of m.ticks ?? []) if (+ts > (lastOf.get(a) ?? 0)) {   // hello resends ticks already drawn
      lastOf.set(a, +ts); if (+ts > lastTs) lastTs = +ts; h.onTick(a, +ts, +p / 1e8); }
    if (t === 'hello' && m.quotes) setQuotes(a, m.quotes);
    if (t === 'quotes') setQuotes(a, m);
    if (t === 'touch') h.onEvent('HexTouched', { asset: a, k: +m.k, j: +m.j, ts_ms: +(m.tsMs ?? m.ts) });   // at settle time now (DECISIONS)
    if (t === 'activity') return act(m);   // the stream sends the latest 30 on connect (backfill: true), then each final one
    if (t !== 'bet' && t !== 'settled') return;
    const who = String(m.player ?? m.owner).toLowerCase(), ev = { asset: a, k: +m.k, j: +m.j, stake: +m.stake, mult: +m.mult, outcome: +m.outcome, credited: +m.credited };
    if (who !== myAddr) { if (t === 'bet') h.onOther?.({ ...ev, owner: String(m.player ?? m.owner) }); return; }   // checksummed, as the API sends it (SPEC-MONAD §6)
    if (t === 'settled') { settlePopup(m); h.onEvent('BetSettled', ev); }
    refreshSoon();
  };
  // SSE: the browser reconnects a dropped stream by itself, but gives up on an HTTP error (a 502 during a deploy): then
  // a new one after 3 s. hello resends each market's last ticks, and lastOf drops the ones already drawn.
  const on = (ev: MessageEvent) => { let m; try { m = JSON.parse(ev.data); } catch { return; } handle(m.t ?? ev.type, m); };
  const open = () => {
    const es = new EventSource(API + '/stream');
    es.onmessage = on;   // {t: ...} on unnamed events; named events (event: ticks) reach the listeners below instead
    for (const t of ['hello', 'ticks', 'quotes', 'touch', 'bet', 'settled', 'activity']) es.addEventListener(t, on as EventListener);
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) { recent(); setTimeout(open, 3000); } };
  };
  open();
}
// while the stream is down (an HTTP error: it reopens every 3 s), the feed's latest items from GET /activity (newest first),
// at most every 15 s; the feed drops the ones it has (by id)
let recentAt = 0;
function recent() {
  if (Date.now() - recentAt < 15_000) return;
  recentAt = Date.now();
  api('/activity?limit=30').then((r) => { for (const m of [...(r.items ?? [])].reverse()) act({ ...m, backfill: true }); }, () => {});
}

// one popup per settle transaction (one column of one market), summing this wallet's bets in it
const settles = new Map<string, { n: number; net: number; credited: number }>();   // ponytail: one entry per settle tx this session
function settlePopup(m: any) {
  const s = settles.get(m.hash) ?? { n: 0, net: 0, credited: 0 }, o = +m.outcome;
  settles.set(m.hash, s);
  s.n++; s.net += +m.credited - +m.stake; s.credited += +m.credited;
  const one = o === 1 ? 'Boom' : o === 3 ? 'Refunded' : 'Dud', amt = s.n === 1 && o === 3 ? usd(s.credited) : (s.net > 0 ? '+' : s.net < 0 ? '−' : '') + usd(Math.abs(s.net));
  const mk = base(+m.asset);
  pop({ id: 'settle' + m.hash, kind: 'settle', status: 'confirmed', hash: m.hash, title: (mk ? mk + ' · ' : '') + (s.n > 1 ? `${s.n} bets settled` : one), detail: amt });
}

/** (c) Signs Bet{player, asset, k, j, stake, minMult, nonce, deadline} for the displayed quote of the market's column k
 *  and POSTs /bet with that quote. Bets run in parallel, one per nonce. Resolves {nonce, mult} once it is in a block;
 *  rejects with .errName. */
async function placeBet(a: { asset: number; k: number; j: number; stake: number; minMult: number }) {
  const q = fresh(a.asset, a.k), mult = q?.mults[a.j - q.qJ0];
  if (!q || !mult) throw named('QuoteStale');   // the quote expired or moved since it was drawn
  const me = wallet(), nonce = takeNonce();
  const bet = { player: me.address, asset: a.asset, k: a.k, j: a.j, stake: BigInt(a.stake), minMult: a.minMult, nonce: BigInt(nonce), deadline: deadline() };
  await relay({ id: 'bet' + ++seq, kind: 'bet', title: `${base(a.asset)} · ${stakeStr(a.stake)} · ${(mult / 100).toFixed(2)}x` }, nonce, async () =>
    api('/bet', { bet, sig: await signBet(me, dom, bet), quote: { asset: a.asset, rowE8: q.rowE8, k: q.k, qJ0: q.qJ0, refTsMs: q.refTsMs, refPriceE8: q.refPriceE8,
      expiresMs: q.expiresMs }, mults: q.mults, quoteSig: q.sig }));
  return { nonce, mult: mult / 100 };
}

/** Withdraw{player, amount, nonce, deadline} -> POST /withdraw -> withdrawFor pays tUSDC to this wallet's own address. */
async function requestWithdraw(amountMicro: number) {
  const me = wallet(), nonce = takeNonce(), w = { player: me.address, amount: BigInt(amountMicro), nonce: BigInt(nonce), deadline: deadline() };
  await relay({ id: 'wd' + ++seq, kind: 'withdraw', title: 'Withdraw ' + usd(amountMicro) }, nonce, async () =>
    api('/withdraw', { ...w, sig: await signWithdraw(me, dom, w) }));
}

/** Add funds: the wallet's tUSDC back into credit. Deposit + tUSDC permit (nonce = TestUSDC.nonces, from GET /player
 *  permitNonce) -> POST /deposit -> depositFor. */
async function fund(amountMicro: number) {
  const me = wallet(), m = await api('/player/' + me.address), nonce = takeNonce();
  const dep = { player: me.address, amount: BigInt(amountMicro), nonce: BigInt(nonce), deadline: deadline() };
  await relay({ id: 'dep' + ++seq, kind: 'deposit', title: 'Deposit ' + usd(amountMicro) }, nonce, async () => {
    const s = await signDeposit(me, dom, udom, dep, BigInt(m.permitNonce ?? 0));
    return api('/deposit', { ...dep, sig: s.sig, v: s.v, r: s.r, s: s.s });
  });
}
/** The wallet's own tUSDC (not in play), micro-USDC, read fresh. */
const walletMicro = async () => Number((await api('/player/' + wallet().address)).wallet ?? 0);

const fresh = (asset: number, k: number) => { const q = quotes.get(asset)?.get(k); return q && q.exp >= tapeNow() ? q : undefined; };
const row = (asset: number) => rows.get(asset) ?? 0;
(globalThis as Record<string, unknown>).HexitChain = {
  init, onboard, returning, start, watch, placeBet, requestWithdraw, fund, walletMicro, balanceMicro, nonceUsed, mergeHistory, boardGeom,
  feedKey, feedView, ago,   // the live feed's cards (index.html HexitTx)
  address: () => wallet().address,
  player: () => api('/player/' + wallet().address),   // {wallet, credit, openStake, ...} micro-USDC strings
  leaderboard: (period: string) => api('/leaderboard?period=' + encodeURIComponent(period)),   // daily | weekly | all
  history: () => api('/player/' + wallet().address + '/history?limit=50'),   // {bets, stats}; stats null without a database
  firstOpenCol: (nowS: number) => firstOpenColumn(nowS * 1000, cfg?.lockMarginMs ?? 1000),
  jOf: (asset: number, c: number, L: number) => jOf(c, L, row(asset)),
  multAt: (asset: number, c: number, L: number) => multAt(fresh(asset, c), c, L, row(asset)),
  hasQuotes: (asset: number) => { for (const k of quotes.get(asset)?.keys() ?? []) if (fresh(asset, k)) return true; return false; },
  overPayout: (stake: number, mult: number) => overPayout(Math.round(stake * 1e6), Math.round(mult * 100), maxPayout),
};
