// Pure helpers behind index.html's board, balance and profile (bundled into dist/hexit-chain.js). No chain I/O here.

/** Contract band index j of the prototype cell (column c, lower edge L in USD); odd columns sit half a band higher. */
export const jOf = (c: number, L: number, row: number): number => Math.round(L / row - 0.5 * (c & 1));

/** A signed quote for column k (SSE `quotes`): mults[i] = multiplier x100 for band qJ0 + i. */
export interface QuotedColumn { k: number; qJ0: number; mults: ArrayLike<number> }

/** Prototype getMult contract: null = not quoted here, 0 = shown but not offered ("—"), else the multiplier. */
export function multAt(col: QuotedColumn | undefined, c: number, L: number, row: number): number | null {
  if (!col || col.k !== c) return null;
  const i = jOf(c, L, row) - col.qJ0;
  return i < 0 || i > 63 ? null : col.mults[i] / 100;
}

/** The contract's PayoutCap check (HexitGame placeBet step 12): stake in micro-USDC, mult x100. */
export const overPayout = (stakeMicro: number, multX100: number, maxPayoutMicro: number): boolean =>
  Math.floor(stakeMicro * multX100 / 100) > maxPayoutMicro;

/** HexitGame's unordered nonce window (contracts/README.md "Nonces"), shared by Bet, Withdraw and Deposit: bit i of
 *  mask = nonce base + i used; every nonce below base is used. */
export const nonceUsed = (base: number, mask: number, n: number): boolean =>
  n < base || (n < base + 32 && ((mask >>> (n - base)) & 1) === 1);

/** The lowest nonce the chain has not used and this app is not holding (busy: signed, maybe still in flight), or -1
 *  when all 32 of the window are taken. */
export function freeNonce(base: number, mask: number, busy: (n: number) => boolean): number {
  for (let n = base; n < base + 32; n++) if (!nonceUsed(base, mask, n) && !busy(n)) return n;
  return -1;
}

/** A board tap as the app tracks it: its market (asset), column c, band j, stake (USD) and mult as shown, local state,
 *  and n = the nonce its signed Bet carries (unset until signed; -1 = restored from GET /player, so already booked). */
export interface Tap { asset?: number; c: number; j: number; stake: number; mult: number; state: string; n?: number }
/** The player's open bets (GET /player bets): stake in micro-USDC, mult x100. */
export interface OpenBet { asset?: number; k: number; j: number; stake: number; mult: number }

/** The app's one balance, micro-USDC, from one GET /player snapshot (credit, nonce window, open bets) and the board's
 *  taps. A tap open on chain adds what settleColumn will credit for a win or refund shown on screen. A tap the chain has
 *  not booked yet (in flight, or the snapshot is older than it) costs its stake now and pays what the screen shows. A
 *  tap whose nonce the snapshot shows used and that is no longer open is settled: credit already has it. */
export function balanceMicro(credit: number, nonceBase: number, nonceMask: number, open: OpenBet[], taps: Tap[]): number {
  let bal = credit;
  for (const t of taps) {
    const b = open.find((b) => b.asset === t.asset && b.k === t.c && b.j === t.j);   // the same (k, j) on another market is another bet
    if (!b && (t.state === 'rejected' || (t.n !== undefined && nonceUsed(nonceBase, nonceMask, t.n)))) continue;
    const stake = b ? b.stake : Math.round(t.stake * 1e6);
    if (!b) bal -= stake;
    if (t.state === 'won') bal += Math.floor(stake * (b ? b.mult : Math.round(t.mult * 100)) / 100);   // settleColumn: stake * mult / 100
    else if (t.state === 'void') bal += stake;
  }
  return bal;
}

/** A resolved tap as the Profile lists it: stake and pnl in USD, mult as a multiple, t (resolved) and placed in seconds;
 *  asset, k, j = its market and hex on chain. */
export interface Trade { asset?: number; mult: number; stake: number; state: string; pnl: number; t: number; k?: number; j?: number; placed?: number }
/** GET /player/:owner/history: micro-USDC strings, mult x100, outcome 1 WIN 2 LOSS 3 VOID (null = open), times in ms. */
export interface History {
  bets: { asset?: number; k: number; j: number; stake: string; mult: number; outcome: number | null; credited: string | null; placedAt: number | null; settledAt: number | null }[];
  stats: { taps: number; wins: number; losses: number; bestMult: number | null; pnl: string } | null;
}

/** The Profile's trades and stats: this session's resolved taps and the persisted settled bets they do not already show
 *  (same asset, k, j), newest first; the persisted all-time stats plus the session taps the server has not counted. The bets are
 *  the newest by placement: when the stats count more (the list is cut), a tap placed before the oldest one listed is
 *  counted already. */
export function mergeHistory(h: History | null, live: Trade[]) {
  const id = (t: { asset?: number; k?: number; j?: number }) => `${t.asset}|${t.k}|${t.j}`, bets = h?.bets ?? [], s = h?.stats;
  const shown = new Set(live.map(id)), placed = new Set(bets.map(id));
  const settled = new Set(bets.filter((b) => b.outcome).map(id));
  const cut = s && s.taps > bets.length ? bets[bets.length - 1]?.placedAt ?? null : null;
  const counted = (ids: Set<string>, t: Trade) => ids.has(id(t)) || (cut != null && t.placed != null && t.placed * 1000 < cut);
  const trades = [...live, ...bets.filter((b) => b.outcome && !shown.has(id(b))).map((b) => ({
    asset: b.asset, mult: b.mult / 100, stake: Number(b.stake) / 1e6, state: b.outcome === 1 ? 'won' : b.outcome === 3 ? 'void' : 'dud',
    pnl: (Number(b.credited) - Number(b.stake)) / 1e6, t: (b.settledAt ?? b.placedAt ?? 0) / 1000, k: b.k, j: b.j }))].sort((a, b) => b.t - a.t);
  const fresh = live.filter((t) => !counted(settled, t)), won = fresh.filter((t) => t.state === 'won');
  const wins = (s?.wins ?? 0) + won.length, losses = (s?.losses ?? 0) + fresh.filter((t) => t.state === 'dud').length;
  return { trades, stats: {
    taps: (s?.taps ?? 0) + live.filter((t) => !counted(placed, t)).length,
    hitRate: wins + losses ? wins / (wins + losses) : null,
    best: Math.max(0, (s?.bestMult ?? 0) / 100, ...won.map((t) => t.mult)) || null,
    pnl: Number(s?.pnl ?? 0) / 1e6 + fresh.reduce((a, t) => a + t.pnl, 0),
  } };
}

/** The board's layout for a canvas of cssW x cssH CSS px. Under 761 px wide: the phone design (hex radius 30, now at
 *  22 %, the price row at 47 %), drawn 1:1. Wider: the desktop HUD is a 1500 x 940 design scaled by s (1 to 1.8; the
 *  head script in index.html sets the same s as --s for the DOM), and the board works in logical px = CSS px / s, with
 *  the 64 px top bar and the 84 px stake dock. The board ends where the newest of the `ahead` quoted columns arrives:
 *  columns move 1.5 R per 5 s, and with the lock rule (left tip >= now + 5.1 s + margin) the newest one's left tip
 *  arrives (28.5 + 0.3 x margin s) R past now, so at (ahead + 1) x 1.5 R the right edge is always covered and a new
 *  column slides in from off-screen. Hexes fill the width with now at 22-24 % (later on screens wider than about 2.3:1,
 *  where the height caps R), at least ~8 bands tall. */
export function boardGeom(cssW: number, cssH: number, ahead = 18) {
  if (cssW < 761) return { desk: false, s: 1, W: cssW, H: cssH, R: 30, nowX: cssW * 0.22, cy: cssH * 0.47, top: 0, bot: 0 };
  const s = Math.min(1.8, Math.max(1, Math.min(cssW / 1500, cssH / 940))), W = cssW / s, H = cssH / s, top = 64, bot = 84;
  const span = (ahead + 1) * 1.5, R = Math.max(30, Math.min(W * 0.76 / span, (H - top - bot) / 13.9));
  return { desk: true, s, W, H, R, nowX: Math.max(W * 0.22, W - span * R), cy: top + (H - top - bot) / 2, top, bot };
}

/** A market as GET /config lists it (markets: [...]): asset id, symbol 'BTC/USD', rowE8 = its price band height x1e8,
 *  decimals = the price digits shown. */
export interface Market { asset: number; symbol: string; rowE8?: string; decimals?: number }
/** The market a live-stream message (hello / ticks / quotes ...) belongs to, for the website: its asset id matched against
 *  /config markets, else '' (a market this page does not list, such as asset 0 on a SOL refund: no card shows it). */
export const marketOf = (msg: { asset?: unknown } | null | undefined, markets?: Market[]): string =>
  markets?.find((x) => msg?.asset != null && x.asset === Number(msg.asset))?.symbol ?? '';

/** A live-feed item (the API's SSE `activity` event, or a row of GET /activity): one real Monad testnet transaction of any
 *  player, kind 'entry' (BetPlaced, the relayer's tx for that bet) or 'settle' (BetSettled). stake / payout in micro-USDC,
 *  mult x100, ts in ms; outcome 1 WIN, 2 LOSS, 3 VOID, null for an entry. */
export interface Activity { id: string; kind: 'entry' | 'settle'; tx: string; ts: number; player: string; handle: string; symbol: string;
  stake: number; mult: number; outcome: number | null; payout: number; backfill: boolean }
/** Checks one item field by field (it comes from the network): null when it is not a well-formed entry or settle, which is
 *  then never shown. Numbers that are not finite and positive read as 0; tx is lowercased (the dedupe key). */
export function activityOf(m: any): Activity | null {
  const kind = m?.kind, tx = String(m?.tx ?? ''), player = String(m?.player ?? ''), outcome = kind === 'settle' ? Number(m.outcome) : null;
  if ((kind !== 'entry' && kind !== 'settle') || !/^0x[0-9a-fA-F]{64}$/.test(tx) || !/^0x[0-9a-fA-F]{40}$/.test(player)
    || (outcome !== null && outcome !== 1 && outcome !== 2 && outcome !== 3)) return null;
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  return { id: String(m.id ?? tx).slice(0, 90), kind, tx: tx.toLowerCase(), ts: n(m.ts) || Date.now(), player,
    handle: String(m.handle ?? '').replace(/[^0-9A-Za-z…]/g, '').slice(0, 16) || player.slice(0, 6) + '…' + player.slice(-4),   // as the leaderboard
    symbol: /^[A-Z0-9]{2,10}\/USD$/.test(m.symbol) ? m.symbol : '', stake: n(m.stake), mult: n(m.mult), outcome,
    payout: outcome === 1 || outcome === 3 ? n(m.payout ?? m.credited) : 0, backfill: m.backfill === true };
}
/** The feed card an item belongs to: an entry is its own; a settle joins that player's other bets settled in the same
 *  transaction (the keeper settles a column in one), as the game's own settle popup sums them. */
export const feedKey = (a: Activity): string => (a.kind === 'entry' ? a.id : 's' + a.tx + a.player.toLowerCase());
const usd2 = (micro: number) => '$' + (micro / 1e6).toFixed(2);
const stakeTxt = (micro: number) => (micro < 1e6 || micro % 1e6 ? usd2(micro) : '$' + micro / 1e6);   // $0.10, $1 (the game's fmtStake), $1.50
const multTxt = (x100: number) => { const m = x100 / 100; return m >= 100 ? '100x' : m >= 10 ? m.toFixed(1) + 'x' : m.toFixed(2) + 'x'; };   // fmtMult
/** What one feed card says, from its items (feedKey): tone entry / win (BOOM, the payout) / void (REFUND, the stake back)
 *  / loss (NO HIT); who: the player ('You' for the wallet me); title: the payout for a win or refund, else stake @
 *  multiplier; sub: beside it, the market (after the stake @ multiplier under a payout). */
export function feedView(items: Activity[], me = '') {
  const a = items[0], you = !!me && a.player.toLowerCase() === me.toLowerCase();
  const stake = items.reduce((s, x) => s + x.stake, 0), payout = items.reduce((s, x) => s + x.payout, 0);
  const tone = a.kind === 'entry' ? 'entry' : items.some((x) => x.outcome === 1) ? 'win' : items.every((x) => x.outcome === 3) ? 'void' : 'loss';
  const bet = items.length > 1 ? `${items.length} bets · ${stakeTxt(stake)}` : `${stakeTxt(stake)} @ ${multTxt(a.mult)}`, paid = tone === 'win' || tone === 'void';
  return { tone, badge: { entry: 'Entry', win: 'Boom', void: 'Refund', loss: 'No hit' }[tone], title: paid ? usd2(payout) : bet,
    who: you ? 'You' : a.handle, sub: [paid ? bet : '', a.symbol].filter(Boolean).join(' · '), you, hash: a.tx.slice(0, 6) + '…' + a.tx.slice(-4) };
}
/** How long ago, as the feed says it: now, 12s, 3m, 2h, 4d. */
export const ago = (ms: number): string => { const s = Math.max(0, Math.floor(ms / 1000));
  return s < 1 ? 'now' : s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
