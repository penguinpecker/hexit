// Bundled by build.mjs into dist/site.js: the live parts of the website (no wallet, no viem). It reads only the API's
// public routes: /config, /health, /leaderboard and the SSE /stream, and draws what they say, never a sample.
//  - #heroBoard: the live honeycomb behind the home hero (the 100 ms tape as the fuse, the signed multipliers on the hexes)
//  - [data-m="BTC/USD"]: a market card (price, 60 s change, the last minute of tape)
//  - [data-h]: a number from /health or the leaderboard; [data-live]: the tape's status
//  - [data-lb]: a leaderboard list, switched by [data-period] tabs
//  - [data-feed]: the live feed of every player's real Monad testnet entries and settlements (SSE `activity`)
import { multAt, marketOf, activityOf, feedKey, feedView, ago, type QuotedColumn, type Market, type Activity } from './seams.ts';
import { firstOpenColumn } from '@hexit/pricing';

declare const __HEXIT_API__: string;
const API = __HEXIT_API__;
const $$ = <T extends Element>(s: string) => [...document.querySelectorAll<T>(s)];
const COL_S = 5, HEX_RT = 10 / 3, SHOW_DELAY = 0.35;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (matchMedia('(hover:hover) and (pointer:fine)').matches) $$('[data-tapw]').forEach((e) => (e.textContent = 'click'));   // as the game words it

const get = (path: string) => fetch(API + path, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${path}: HTTP ${r.status}`))));
const usd = (micro: number) => (micro < 0 ? '−' : '+') + '$' + Math.abs(micro / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const price = (p: number, sym: string) => { const d = cfg?.markets?.find((m) => m.symbol === sym)?.decimals ?? 2;   // the digits the game shows
  return '$' + p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
const isAddr = (a: unknown): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const every = (ms: number, f: () => void) => { f(); setInterval(() => { if (!document.hidden) f(); }, ms); };

// ---------------------------------------------------------------- the live feed, per market
interface Cfg { lockMarginMs?: number; markets?: Market[] }
interface Quote extends QuotedColumn { exp: number }
interface Feed { ticks: { t: number; p: number }[]; quotes: Map<number, Quote>; at: number; lag: Float64Array; li: number; off: number }
let cfg: Cfg | null = null, sseErr = false, onStream = () => {}, tapeOff = 0;   // onStream: this page's own stream just opened (numbers() re-reads /health)
const tapeNow = () => Date.now() - tapeOff * 1000;   // the server's clock (one for every market), whatever this device's says: the feed's ages
const feeds = new Map<string, Feed>();
const feed = (sym: string) => { let f = feeds.get(sym); if (!f) feeds.set(sym, (f = { ticks: [], quotes: new Map(), at: 0, lag: new Float64Array(50).fill(1e9), li: 0, off: 0 })); return f; };
const rowOf = (sym: string) => Number(cfg?.markets?.find((m) => m.symbol === sym)?.rowE8 ?? 0) / 1e8;

function onMsg(t: string, m: any) {
  if (t === 'activity') return onActivity(m);
  const f = feed(marketOf(m, cfg?.markets));   // '' for a market /config does not list (asset 0 on a SOL refund): drawn nowhere
  if (t === 'hello' || t === 'ticks') {
    for (const [ts, px] of m.ticks ?? []) {
      const s = { t: +ts / 1000, p: +px / 1e8 }, last = f.ticks[f.ticks.length - 1];
      if (last && s.t <= last.t) continue;
      f.ticks.push(s); f.at = Date.now();
      f.lag[f.li++ % 50] = f.at / 1000 - s.t; f.off = tapeOff = Math.min(...f.lag);   // device clock minus tape clock, least lag of the last 50 (as the game)
    }
    if (f.ticks.length > 1400) f.ticks.splice(0, f.ticks.length - 1400);
  }
  const q = t === 'quotes' ? m : t === 'hello' ? m.quotes : null;
  if (q) { f.quotes.clear(); for (const c of q.cols ?? []) f.quotes.set(+c.k, { k: +c.k, qJ0: +c.qJ0, mults: c.mults.map(Number), exp: Number(c.expiresMs ?? q.expiresMs) }); }
}
function stream() {   // the same reconnect rule as the game: the browser retries a dropped stream, a new one after an HTTP error
  const es = new EventSource(API + '/stream'), on = (ev: MessageEvent) => { let m; try { m = JSON.parse(ev.data); } catch { return; } sseErr = false; onMsg(m.t ?? ev.type, m); };
  es.onmessage = on;
  es.onopen = () => onStream();
  for (const t of ['hello', 'ticks', 'quotes', 'activity']) es.addEventListener(t, on as EventListener);
  es.onerror = () => { sseErr = true; if (es.readyState === EventSource.CLOSED) setTimeout(stream, 3000); };
}
const fresh = (f: Feed | undefined) => !!f && Date.now() - f.at < 3000;

// ---------------------------------------------------------------- the hero: the live honeycomb
// The game's board, read-only: flat-top glass hexes (5 s columns, odd ones half a band higher), the signed multipliers,
// the lock line and the fuse. Each tile look is drawn once into a device-pixel sprite and stamped; no network, decoding
// or DOM inside the frame. Drawn only while on screen.
function hero(cv: HTMLCanvasElement) {
  const ctx = cv.getContext('2d')!;
  let W = 0, H = 0, dpr = 1, R = 40, k = 1, nowX = 0, cy = 0, camP: number | null = null, sym: string | undefined, on = false, raf = 0, last = 0;
  const spr = new Map<string, HTMLCanvasElement>(), grad: Record<string, CanvasGradient> = {};
  const TF = ['rgba(62,43,92,.26)', 'rgba(62,43,92,.16)', 'rgba(242,106,255,.07)', 'rgba(62,43,92,.10)'];   // base, near the price, hot, locked
  const TE = ['rgba(208,188,255,.2)', 'rgba(208,188,255,.2)', 'rgba(242,106,255,.3)', 'rgba(208,188,255,.07)', 'rgba(242,106,255,.5)'];   // ... and the price in the band
  const hexPath = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => { c.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; i ? c.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)) : c.moveTo(x + r, y); } c.closePath(); };
  const half = (c: CanvasRenderingContext2D, r: number, i0: number) => { c.beginPath(); for (let i = i0; i <= i0 + 3; i++) { const a = Math.PI / 3 * i; i === i0 ? c.moveTo(r * Math.cos(a), r * Math.sin(a)) : c.lineTo(r * Math.cos(a), r * Math.sin(a)); } };
  function sprite(fi: number, ei: number) {   // the game's glass(): tinted body, light from above, a sheen band, a light lip and a shaded base
    const key = fi + '|' + ei; let s = spr.get(key); if (s) return s;
    const r = R - 2.5, o = Math.ceil((r + 2) * dpr); s = document.createElement('canvas'); s.width = s.height = 2 * o;
    const c = s.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, o, o);
    hexPath(c, 0, 0, r); c.fillStyle = TF[fi]; c.fill();
    if (fi !== 3) {
      const g = (y0: number, y1: number, st: [number, string][], x0 = 0, x1 = 0) => { const q = c.createLinearGradient(x0 * r, y0 * r, x1 * r, y1 * r); for (const [a, b] of st) q.addColorStop(a, b); return q; };
      c.fillStyle = g(-1, 1, [[0, 'rgba(208,188,255,.10)'], [.5, 'rgba(208,188,255,0)'], [1, 'rgba(7,1,15,.22)']]); c.fill();
      c.fillStyle = g(-1, .35, [[0, 'rgba(255,255,255,.11)'], [.44, 'rgba(255,255,255,.035)'], [.45, 'rgba(255,255,255,0)']], -1, .35); c.fill();
      c.lineWidth = 1; half(c, r - 1, 3); c.strokeStyle = 'rgba(255,255,255,.09)'; c.stroke(); half(c, r - 1.25, 0); c.strokeStyle = 'rgba(7,1,15,.45)'; c.stroke();
    }
    hexPath(c, 0, 0, r); c.lineWidth = 1; c.strokeStyle = TE[ei]; c.stroke();
    spr.set(key, s); return s;
  }
  function resize() {
    const b = cv.getBoundingClientRect(); if (!b.width) return;
    W = b.width; H = b.height; dpr = devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const phone = W < 761;
    R = phone ? 26 : Math.max(30, H / (11 * Math.sqrt(3)));   // about 11 bands tall on a desktop, the phone board's size on a phone
    k = Math.min(2.4, Math.max(.7, R / 45)); nowX = W * (phone ? .3 : .26); cy = H * (phone ? .45 : .47);
    spr.clear();
    const lg = (st: [number, string][]) => { const g = ctx.createLinearGradient(0, 0, nowX, 0); for (const [a, c] of st) g.addColorStop(a, c); return g; };
    grad.bloom = lg([[0, 'rgba(242,106,255,0)'], [.55, 'rgba(242,106,255,.04)'], [1, 'rgba(242,106,255,.14)']]);
    grad.glow = lg([[0, 'rgba(242,106,255,0)'], [.55, 'rgba(242,106,255,.16)'], [1, 'rgba(242,106,255,.42)']]);
    grad.core = lg([[0, 'rgba(242,106,255,0)'], [.6, '#f26aff'], [1, '#ffd9ff']]);
    const h = ctx.createRadialGradient(0, 0, 0, 0, 0, 24); h.addColorStop(0, 'rgba(255,217,255,.6)'); h.addColorStop(.3, 'rgba(242,106,255,.28)'); h.addColorStop(1, 'rgba(242,106,255,0)'); grad.head = h;
    draw(performance.now());
  }
  const fonts = new Map<number, string>(), font = (px: number) => { let f = fonts.get(px); if (!f) fonts.set(px, (f = `700 ${px}px "Space Grotesk", sans-serif`)); return f; };
  const fmt = (m: number) => (m >= 100 ? '100' : m >= 10 ? m.toFixed(1) : m.toFixed(2));
  function loop(t: number) {
    raf = on ? requestAnimationFrame(loop) : 0;
    if (reduceMotion && t - last < 950) return;   // reduced motion: one still frame a second
    last = t; draw(t);
  }
  function draw(t: number) {
    if (!W) return;
    if (sym === undefined || !fresh(feeds.get(sym))) {   // the feed to draw: BTC/USD when it is live, else the first live one
      const ok = [...feeds.keys()].filter((s) => fresh(feeds.get(s)) && feeds.get(s)!.ticks.length > 1), next = ok.includes('BTC/USD') ? 'BTC/USD' : ok[0];
      if (next !== undefined && next !== sym) { sym = next; camP = null; }
    }
    const f = sym !== undefined ? feeds.get(sym) : undefined, row = sym !== undefined ? rowOf(sym) : 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const sm = f?.ticks ?? [], live = sm.length > 1 && row > 0;
    const now = Date.now() / 1000 - (f?.off ?? 0) - SHOW_DELAY;
    let hi = sm.length - 1; while (hi > 0 && sm[hi].t > now) hi--;
    const a = sm[hi], b = sm[hi + 1], hp = !live ? 0 : b && now > a.t ? a.p + (b.p - a.p) * (now - a.t) / (b.t - a.t) : a.p;
    if (live) { camP = camP == null ? hp : camP + (hp - camP) * .06; }
    const pxs = 1.5 * R / COL_S, ppp = live ? Math.sqrt(3) * R / row : 1;
    const X = (s: number) => nowX + (s - now) * pxs, Y = (p: number) => cy - (p - (camP ?? 0)) * ppp;
    const c0 = firstOpenColumn((now + SHOW_DELAY) * 1000, cfg?.lockMarginMs ?? 1000), lockX = X(c0 * COL_S + COL_S / 2 - HEX_RT);
    const fs = Math.round(Math.min(40, Math.max(9, R * .4)) * 4) / 4;
    // tiles: right of the head only, as the game draws them (past columns hold only a player's own bets)
    const bands = Math.ceil(H / (Math.sqrt(3) * R)) + 2, cur = Math.floor(now / COL_S);
    for (let c = cur; ; c++) {
      const x = X((c + .5) * COL_S); if (x > W + R) break; if (x < nowX - R) continue;
      const off = (c & 1) * .5, locked = c < c0, q = f?.quotes.get(c), qok = q && q.exp >= (now + SHOW_DELAY) * 1000 ? q : undefined;
      const r0 = live ? Math.floor(((camP ?? 0) - (H - cy) / ppp) / row - off) - 1 : -bands, r1 = live ? r0 + bands + 1 : bands;
      for (let r = r0; r <= r1; r++) {
        const L = (r + off) * row, y = live ? Y(L + row / 2) : cy - (r + off) * Math.sqrt(3) * R;
        if (y < -R || y > H + R) continue;
        const m = locked || !live ? null : multAt(qok, c, L, row), near = live && !locked && Math.abs(L + row / 2 - hp) < row * 1.6;
        const fi = locked ? 3 : m != null && m >= 10 ? 2 : near ? 1 : 0, ei = locked ? 3 : live && L <= hp && hp <= L + row ? 4 : fi === 2 ? 2 : 0;
        ctx.globalAlpha = Math.max(0, Math.min(1, y / (R * 1.6), (H - y) / (R * 1.6)));
        const s = sprite(fi, ei), o = s.width / 2;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(s, Math.round(x * dpr) - o, Math.round(y * dpr) - o); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (m) {
          ctx.fillStyle = near ? 'rgba(208,188,255,.4)' : m >= 10 ? '#fda9ff' : '#d0bcff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
          const n = fmt(m); ctx.font = font(fs); const bw = ctx.measureText(n).width; ctx.font = font(fs * .75); const xw = ctx.measureText('x').width, sx = x - (bw + xw) / 2;
          ctx.font = font(fs); ctx.fillText(n, sx, y + 1); ctx.font = font(fs * .75); ctx.fillText('x', sx + bw + 1, y + 2);
        } else if (m === 0) { ctx.fillStyle = 'rgba(208,188,255,.3)'; ctx.font = font(Math.max(9, fs * .6)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('—', x, y); }
      }
    }
    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
    if (lockX > nowX && lockX < W) {   // lock line: no new taps left of it
      ctx.strokeStyle = 'rgba(208,188,255,.18)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(lockX, 30 * k + 8); ctx.lineTo(lockX, H - 20); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = font(Math.round(9 * k)); ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(208,188,255,.45)'; ctx.fillText('LOCK', lockX, 30 * k);
    }
    if (!live) return;
    // the fuse: bloom + glow (additive) + core, straight between ticks (bets settle on those segments)
    let i0 = 0; const tMin = now - nowX / pxs - 1; while (i0 < hi && sm[i0].t < tMin) i0++;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
    for (let i = i0; i <= hi; i++) { const x = X(sm[i].t), y = Y(sm[i].p); i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    const hy = Y(hp); ctx.lineTo(nowX, hy);
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = grad.bloom; ctx.lineWidth = 12 * k; ctx.stroke(); ctx.strokeStyle = grad.glow; ctx.lineWidth = 5 * k; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = grad.core; ctx.lineWidth = 2.25 * k; ctx.stroke();
    ctx.globalCompositeOperation = 'lighter'; ctx.translate(nowX, hy); ctx.scale(k, k); ctx.fillStyle = grad.head; ctx.fillRect(-24, -24, 48, 48); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = fresh(f) ? '#fff' : '#8b919d'; ctx.beginPath(); ctx.arc(nowX, hy, 4 * k, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,.85)'; ctx.lineWidth = 1.5 * k; ctx.beginPath(); ctx.arc(nowX, hy, (7.5 + (reduceMotion ? 0 : Math.sin(t / 1000 * 7.5) * .75)) * k, 0, 7); ctx.stroke();
    if (sym) {   // a named market: its price on the head, as the board shows it (an unnamed feed shows no price)
      const txt = sym + '  ' + price(sm[hi].p, sym); ctx.font = font(Math.round(12 * k)); const w = ctx.measureText(txt).width + 16 * k, hh = 22 * k, x0 = nowX - w / 2, y0 = hy - 16 * k - hh;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w - 6 * k, y0); ctx.lineTo(x0 + w, y0 + 6 * k); ctx.lineTo(x0 + w, y0 + hh); ctx.lineTo(x0 + 6 * k, y0 + hh); ctx.lineTo(x0, y0 + hh - 6 * k); ctx.closePath();
      ctx.fillStyle = '#f26aff'; ctx.fill(); ctx.fillStyle = '#2a0033'; ctx.textAlign = 'center'; ctx.fillText(txt, nowX, y0 + hh / 2 + 4 * k);
    }
  }
  new ResizeObserver(resize).observe(cv);
  const start = () => { if (on && !raf) raf = requestAnimationFrame(loop); };
  new IntersectionObserver(([e]) => { on = e.isIntersecting && !document.hidden; start(); }).observe(cv);
  document.addEventListener('visibilitychange', () => { on = !document.hidden && cv.getBoundingClientRect().bottom > 0; start(); });
}

// ---------------------------------------------------------------- the live feed: the newest 3 cards (the stream sends the
// latest 30 on connect, then each final one). One card per entry and per player per settle tx (seams.ts feedKey), written at
// most every 250 ms, never inside the hero's frame; a quiet board keeps its last real items with their age.
const groups = new Map<string, { items: Activity[]; seq: number; li?: HTMLLIElement }>(), seenAct = new Set<string>();
let actSeq = 0, feedT = 0;
function onActivity(m: unknown) {
  const a = activityOf(m); if (!a || seenAct.has(a.id)) return;   // a reconnect resends the latest 30
  seenAct.add(a.id);
  const k = feedKey(a), g = groups.get(k) ?? { items: [], seq: ++actSeq };
  g.items.push(a); groups.set(k, g); if (g.li) fillCard(g.li, g.items);
  if (!feedT) feedT = window.setTimeout(paintFeed, 250);
}
function fillCard(li: HTMLLIElement, items: Activity[]) {
  const v = feedView(items), el = (tag: string, cls: string, text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
  const r1 = el('span', 'r1'), r2 = el('span', 'r2'), a = el('a', 'h', v.hash) as HTMLAnchorElement, ext = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  r1.append(el('b', 'bd', v.badge), el('span', 'who', v.who)); r2.append(el('span', 't', v.title), ' ', el('small', '', v.sub));
  a.href = 'https://testnet.monadvision.com/tx/' + items[0].tx; a.target = '_blank'; a.rel = 'noopener';   // tx: 0x + 64 hex (activityOf)
  ext.setAttribute('class', 'ext'); ext.setAttribute('aria-hidden', 'true'); use.setAttribute('href', '#ext'); ext.append(use); a.append(ext);
  li.dataset.tone = v.tone; li.dataset.ts = String(Math.max(...items.map((x) => x.ts)));
  li.replaceChildren(r1, a, r2, el('span', 'tm', ago(tapeNow() - Number(li.dataset.ts))));
}
function paintFeed() {
  feedT = 0;
  const box = document.querySelector<HTMLElement>('[data-feed]'); if (!box) return;
  const top = [...groups.entries()].sort((a, b) => b[1].seq - a[1].seq);
  for (const [k] of top.slice(12)) groups.delete(k);
  if (seenAct.size > 800) { let n = seenAct.size - 400; for (const id of seenAct) { if (n-- <= 0) break; seenAct.delete(id); } }
  const lis = top.slice(0, 3).map(([, g]) => { if (!g.li) { g.li = document.createElement('li'); g.li.className = 'new'; g.li.addEventListener('animationend', () => g.li!.classList.remove('new'), { once: true }); fillCard(g.li, g.items); } return g.li; });
  box.querySelector('ol')!.replaceChildren(...lis);
  box.hidden = !lis.length;
}
setInterval(() => { if (!document.hidden) for (const li of document.querySelectorAll<HTMLElement>('[data-feed] li')) {
  const t = ago(tapeNow() - Number(li.dataset.ts)), e = li.querySelector('.tm')!; if (e.textContent !== t) e.textContent = t; } }, 1000);

// ---------------------------------------------------------------- market cards: price, 60 s change, the last minute of tape
function cards() {
  const els = $$<HTMLElement>('[data-m]'); if (!els.length) return;
  const seen = new Set<string>();
  setInterval(() => {
    for (const el of els) {
      const sym = el.dataset.m!, f = feeds.get(sym), live = fresh(f), q = (s: string) => el.querySelector<HTMLElement>(s)!;
      if (live) seen.add(sym);
      el.classList.toggle('on', live);
      const st = live ? 'Live' : seen.has(sym) ? 'Reconnecting' : 'Not live yet'; if (q('[data-st]').textContent !== st) q('[data-st]').textContent = st;
      if (!live) continue;
      const sm = f!.ticks, p = sm[sm.length - 1].p, t0 = sm[sm.length - 1].t - 60, first = sm.find((s) => s.t >= t0)!, chg = (p - first.p) / first.p * 100;
      q('[data-px]').textContent = price(p, sym);
      q('[data-chg]').textContent = `${chg >= 0 ? '+' : '−'}${Math.abs(chg).toFixed(3)}% in the last ${Math.round(sm[sm.length - 1].t - first.t)} s`;
      const cv = q('[data-tape]') as HTMLCanvasElement, b = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
      if (cv.width !== Math.round(b.width * d)) { cv.width = Math.round(b.width * d); cv.height = Math.round(b.height * d); }
      const c = cv.getContext('2d')!, pts = sm.filter((s) => s.t >= t0); let lo = Infinity, hi = -Infinity; for (const s of pts) { lo = Math.min(lo, s.p); hi = Math.max(hi, s.p); }
      const w = b.width, h = b.height, pad = 6, ts = pts[0].t, span = Math.max(1, sm[sm.length - 1].t - ts), X = (t: number) => (t - ts) / span * (w - pad), Y = (v: number) => hi > lo ? pad + (hi - v) / (hi - lo) * (h - 2 * pad) : h / 2;
      c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h); c.lineJoin = 'round'; c.beginPath();
      pts.forEach((s, i) => (i ? c.lineTo(X(s.t), Y(s.p)) : c.moveTo(X(s.t), Y(s.p))));
      c.strokeStyle = 'rgba(242,106,255,.25)'; c.lineWidth = 6; c.stroke(); c.strokeStyle = '#f26aff'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(X(pts[pts.length - 1].t), Y(p), 3.5, 0, 7); c.fill();
    }
  }, 250);
}

// ---------------------------------------------------------------- live numbers: /health and the leaderboard's leader
function numbers() {
  const put = (k: string, v: string) => $$<HTMLElement>(`[data-h="${k}"]`).forEach((e) => { if (e.textContent !== v) e.textContent = v; });
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v.toLocaleString('en-US') : '—');
  if ($$('[data-h]').length) {
    const health = () => get('/health').then((h) => {
      put('players', n(h.players)); put('sse', n(h.sse)); put('bets', n(h.tx?.bet?.ok ?? 0)); put('settles', n(h.tx?.settle?.ok ?? 0)); put('block', n(h.headBlock));
    }, () => {});
    every(15_000, health);
    onStream = health;   // the first read runs before this page's stream opens: "watching live, this page included" counts it at once

    if ($$('[data-h="top"]').length) every(30_000, () => get('/leaderboard?period=all').then((d) => {
      const r = [...(d.rows ?? [])].filter((r) => isAddr(r.owner)).sort((a, b) => Number(b.pnl) - Number(a.pnl))[0];
      put('top', r ? `${r.owner.slice(0, 6)}\u2026${r.owner.slice(-4)} ${usd(Number(r.pnl))}` : '\u2014');
    }, () => {}));
  }
  const live = $$<HTMLElement>('[data-live]');
  if (live.length) setInterval(() => {
    const any = [...feeds.values()].some(fresh), txt = any ? 'Live tape // 100 ms ticks' : sseErr ? 'Live tape offline // retrying' : 'Connecting to the live tape';
    for (const el of live) { const t = el.querySelector('[data-live-txt]')!, d = el.querySelector('.dot')!; if (t.textContent !== txt) t.textContent = txt; d.classList.toggle('off', !any); }
  }, 500);
}

// ---------------------------------------------------------------- leaderboards
const EXPLAIN: Record<string, string> = { daily: 'P&L of bets settled in the last 24 hours.', weekly: 'P&L of bets settled in the last 7 days.',
  all: 'Everything a wallet holds in test USDC, its balance and its open stakes, minus the welcome grant.' };
function boards() {
  for (const list of $$<HTMLOListElement>('[data-lb]')) {
    const max = Number(list.dataset.max ?? 50);
    const row = (cls: string, text: string) => { const li = document.createElement('li'); li.className = cls; li.textContent = text; return li; };
    const load = () => { const period = list.dataset.lb!; get('/leaderboard?period=' + period).then((d) => {
      if (period !== list.dataset.lb) return;   // a slow answer for the tab just left
      const rows = [...(d.rows ?? [])].filter((r) => isAddr(r.owner)).sort((a, b) => Number(b.pnl) - Number(a.pnl)).slice(0, max);
      list.replaceChildren(...(rows.length ? rows.map((r, i) => {
        const li = document.createElement('li'), rk = document.createElement('span'), a = document.createElement('a'), pl = document.createElement('span'), v = Number(r.pnl);
        rk.className = 'rk'; rk.textContent = String(i + 1);
        a.href = 'https://testnet.monadvision.com/address/' + r.owner; a.target = '_blank'; a.rel = 'noopener'; a.textContent = r.owner.slice(0, 6) + '…' + r.owner.slice(-4); a.title = r.owner;
        pl.className = 'pl ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : ''); pl.textContent = usd(v);
        li.append(rk, a, pl); return li;
      }) : [row('lb-empty', period === 'all' ? 'No funded wallets yet.' : 'No bets settled in this period yet.')]));
    }, () => { if (period === list.dataset.lb && !list.querySelector('.rk')) list.replaceChildren(row('lb-empty', 'Leaderboard unavailable. Retrying.')); }); };
    every(15_000, load);
    for (const tab of $$<HTMLButtonElement>('[data-period]')) tab.addEventListener('click', () => {
      list.dataset.lb = tab.dataset.period!;
      $$<HTMLButtonElement>('[data-period]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      $$('[data-explain]').forEach((e) => (e.textContent = EXPLAIN[tab.dataset.period!]));
      list.replaceChildren(row('lb-empty', 'Loading the leaderboard')); load();
    });
  }
}

// ---------------------------------------------------------------- boot
const cv = document.getElementById('heroBoard') as HTMLCanvasElement | null;
if (cv || $$('[data-m]').length || $$('[data-live]').length || $$('[data-feed]').length) {
  const boot = () => get('/config').then((c) => { cfg = c; stream(); }, () => { sseErr = true; setTimeout(boot, 5000); });
  boot();
  if (cv) hero(cv);
  cards();
}
numbers();
boards();
