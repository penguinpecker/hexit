// Hexit pricing engine (maths: research/pricing/HEX.md).
// buildTable / hexP / round3Down / multX100 / vol* are straight ports of the pricing section of the earlier browser
// prototype, since removed (its outputs are kept in tests/vectors/pricing_prototype.json)
// ("pricing: exact hexagon touch"). Do not "improve" the numerics here: any accuracy change is a
// separate change, measured against research/pricing/hex_pricing.py.
// segHitsInt / ColumnSim mirror contracts/src/HexGeo.sol and HexitGame._applyTape: BigInt only, no floats.
export const COL_MS = 5000, TICK_MS = 100, HEX_R_S = 10 / 3, LOCK_S = 5.1;
export const EDGE = 0.08, CAP_X100 = 10000, MIN_OFFER_X100 = 101;
export const MIX = [[1, 0.6], [1.5, 0.3], [3, 0.1]];
export const SIG_STEP = 0.06, NPH = 2, DXF = 4; // prototype values
export const BOARD_COLS = 18, QUOTE_BANDS = 64, LOCK_MARGIN_MS = 500;
const YEAR_S = 31536000, DT = TICK_MS / 1000;
const LOCK_S_PROTO = LOCK_S + HEX_R_S - COL_MS / 2000; // prototype LOCK_S: now -> centre of first column (5.933 s)
/* ---------------- float engine (prototype port) ---------------- */
// Abramowitz-Stegun normal CDF, exactly as the prototype.
export function Phi(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
}
// Cyrus-Beck in normalised coords a = (t - tc)/R, b = (p - pc)/(row/2): does the segment meet |b| <= 1, 2|a| + |b| <= 2?
const HEX_C = [[0, 1, 1], [0, -1, 1], [2, 1, 2], [2, -1, 2], [-2, 1, 2], [-2, -1, 2]];
export function hexHits(a0, b0, a1, b1) {
    let lo = 0, hi = 1;
    const da = a1 - a0, db = b1 - b0;
    for (let q = 0; q < 6; q++) {
        const [na, nb, c] = HEX_C[q];
        const num = c + 1e-12 - (na * a0 + nb * b0), den = na * da + nb * db;
        if (den > 0) {
            const r = num / den;
            if (r < hi)
                hi = r;
        }
        else if (den < 0) {
            const r = num / den;
            if (r > lo)
                lo = r;
        }
        else if (num < 0)
            return false;
        if (lo > hi)
            return false;
    }
    return true;
}
// Backward transfer-matrix solve over the hex lifetime (100 ms ticks joined by straight lines), averaged over
// `nph` tick phases and carried back to the common reference time (left tip - 0.1 s). sig in bands/sqrt(s).
export function hexU(sig, nph, dxf) {
    const R = HEX_R_S, sd = sig * Math.sqrt(DT), dx = 0.5 / Math.ceil(0.5 * dxf / sd);
    const L = 0.5 + 8 * sig * Math.sqrt(2 * R + DT) + 5 * sd, N = Math.ceil(L / dx), n = 2 * N;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++)
        x[i] = (i - N + 0.5) * dx;
    const K = Math.ceil(7 * sd / dx), w = new Float64Array(2 * K + 1);
    for (let k = -K; k <= K; k++)
        w[k + K] = Phi((k + 0.5) * dx / sd) - Phi((k - 0.5) * dx / sd);
    const acc = new Float64Array(n);
    for (let ph = 0; ph < nph; ph++) {
        const phi = (ph + 0.5) / nph * DT, t0 = -R - phi, nseg = Math.ceil((R - t0) / DT - 1e-9);
        let u = new Float64Array(n), v = new Float64Array(n);
        for (let s = nseg - 1; s >= 0; s--) {
            const ta = t0 + s * DT, a0 = ta / R, a1 = (ta + DT) / R;
            for (let i = 0; i < n; i++) {
                let sum = 0;
                const b0 = 2 * x[i];
                for (let k = -K; k <= K; k++) {
                    const j = i + k;
                    if (hexHits(a0, b0, a1, b0 + 2 * k * dx))
                        sum += w[k + K];
                    else if (j >= 0 && j < n)
                        sum += w[k + K] * u[j];
                }
                v[i] = sum;
            }
            const tmp = u;
            u = v;
            v = tmp;
        }
        const sv = sig * Math.sqrt(DT - phi), M = Math.ceil(6 * sv / dx);
        for (let i = 0; i < n; i++) {
            let sum = 0;
            for (let m = -M; m <= M; m++) {
                const j = i + m;
                if (j < 0 || j >= n)
                    continue;
                sum += (Phi((m * dx + dx / 2) / sv) - Phi((m * dx - dx / 2) / sv)) * u[j];
            }
            acc[i] += sum / nph;
        }
    }
    return { x, u: acc, dx };
}
// Trim zeros and bin u onto a coarse grid (cw) so each quote cell costs ~80 Phi pairs.
export function compact(r, sig) {
    const cw = sig * Math.sqrt(LOCK_S_PROTO - 0.1) / 10, bins = new Map();
    for (let i = 0; i < r.x.length; i++) {
        if (r.u[i] < 1e-12)
            continue;
        const b = Math.floor(r.x[i] / cw);
        bins.set(b, (bins.get(b) || 0) + r.u[i] * r.dx);
    }
    const ks = [...bins.keys()].sort((a, b) => a - b);
    return { sig, edges: Float64Array.from(ks, b => b * cw), w: Float64Array.from(ks, b => bins.get(b) / cw), cw };
}
export function buildTable(sigBands, nph = NPH, dxf = DXF) {
    return compact(hexU(sigBands, nph, dxf), sigBands);
}
export const sigKey = (sig) => Math.round(Math.log(sig) / Math.log(1 + SIG_STEP));
export const keySig = (key) => Math.pow(1 + SIG_STEP, key);
// Tables built at the bucket sigma keySig(sigKey(sig)), memoised. The quoter runs this in a worker_threads Worker.
export class TableCache {
    tables = new Map();
    get(sig) {
        const k = sigKey(sig);
        let t = this.tables.get(k);
        if (!t) {
            t = buildTable(keySig(k));
            this.tables.set(k, t);
        }
        return t;
    }
}
// P(win) for a hex centred d bands above the price, leadS seconds until its left tip.
export function hexP(t, sigUsed, d, leadS) {
    const sL = sigUsed * Math.sqrt(Math.max(leadS - 0.1, 0.01));
    let P = 0;
    for (let i = 0; i < t.edges.length; i++) {
        const e = t.edges[i];
        P += t.w[i] * (Phi((e + t.cw + d) / sL) - Phi((e + d) / sL));
    }
    return P;
}
// Fat tails: P is linear, so the mixture is the weighted sum over vol scales, each from its own bucket table.
export function mixtureP(cache, sigB, d, leadS) {
    let p = 0;
    for (const [kap, wt] of MIX)
        p += wt * hexP(cache.get(kap * sigB), kap * sigB, d, leadS);
    return p;
}
// 3 significant figures, rounded DOWN (house-safe): 0.01 steps below 10x, 0.1 steps from 10x.
export const round3Down = (v) => v < 10 ? Math.floor(v * 100 + 1e-9) / 100 : Math.floor(v * 10 + 1e-9) / 10;
// Multiplier x100 as the contract's uint16: 0 = not offered (< 1.01x, or P not a number), else 101..=10000.
export function multX100(P, edge = EDGE) {
    const raw = (1 - edge) / Math.max(P, 1e-300);
    const m = Math.min(CAP_X100 / 100, round3Down(Math.min(raw, CAP_X100 / 100)));
    return m >= MIN_OFFER_X100 / 100 ? Math.round(m * 100) : 0;
}
const VOL_A = { fast: 1 - Math.pow(0.5, 0.1 / 20), slow: 1 - Math.pow(0.5, 0.1 / 120), now: 1 - Math.pow(0.5, 0.1 / 4) };
const VOL_FLOOR = 0.8, VOL_HALT = 1.25;
export function volInit(price, volAnn) {
    const sigBase = price * volAnn / Math.sqrt(YEAR_S), v0 = sigBase ** 2;
    return { vFast: v0, vSlow: v0, vNow: v0, sigBase };
}
// One 100 ms grid tick; dP = price change in USD.
export function volStep(s, dP) {
    const r2 = dP ** 2 / DT;
    return { vFast: s.vFast + (r2 - s.vFast) * VOL_A.fast, vSlow: s.vSlow + (r2 - s.vSlow) * VOL_A.slow,
        vNow: s.vNow + (r2 - s.vNow) * VOL_A.now, sigBase: s.sigBase };
}
export const sigmaUsd = (s) => Math.max(Math.sqrt(s.vFast), Math.sqrt(s.vSlow), VOL_FLOOR * s.sigBase);
export const volHot = (s) => Math.sqrt(s.vNow) > VOL_HALT * sigmaUsd(s);
/* ---------------- quote grid (a Quote's mults: uint16[64], band qJ0+i) ---------------- */
// Smallest k whose left tip t_lo(k) = 5000k - 834 is >= now + 5100 + margin (the on-chain Locked check).
export const firstOpenColumn = (nowMs, marginMs = LOCK_MARGIN_MS) => Math.ceil((nowMs + LOCK_S * 1000 + marginMs + 834) / COL_MS);
const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; };
export function quoteColumn(a) {
    const { k, nowMs, priceE8, rowE8, sigBands, cache } = a;
    const qJ0 = (a.centreBand ?? Number(floorDiv(priceE8, rowE8))) - QUOTE_BANDS / 2;
    const lead = (COL_MS * k + COL_MS / 2 - HEX_R_S * 1000 - nowMs) / 1000; // seconds to the left tip
    const odd = BigInt(k % 2), den = Number(2n * rowE8), mults = new Uint16Array(QUOTE_BANDS);
    for (let i = 0; i < QUOTE_BANDS; i++) {
        // d = (pc - price)/row with 2*pc = (2j + 1 + (k&1))*row, exact in BigInt before the one division
        const d = Number((2n * BigInt(qJ0 + i) + 1n + odd) * rowE8 - 2n * priceE8) / den;
        mults[i] = multX100(mixtureP(cache, sigBands, d, lead));
    }
    return { k, qJ0, sigBucket: sigKey(sigBands), mults };
}
// 18 columns from firstOpenColumn(now), pulled back one column while the tape runs hot.
export function quoteBoard(a) {
    const sigBands = sigmaUsd(a.vol) / (Number(a.rowE8) / 1e8);
    const k0 = firstOpenColumn(a.nowMs, a.marginMs) + (volHot(a.vol) ? 1 : 0);
    return Array.from({ length: BOARD_COLS }, (_, i) => quoteColumn({ ...a, k: k0 + i, sigBands }));
}
/* ---------------- settlement mirror (BigInt, identical to contracts/src/HexGeo.sol) ---------------- */
export function hexCentreInt(k, j, row) {
    return [5000n * k + 2500n, ((k & 1n) === 0n ? 2n * j + 1n : 2n * j + 2n) * row];
}
// Six half-planes nt*dt + np*dp2 <= c, dt = T - tc (ms), dp2 = 2P - pc2.
const hexConstraintsInt = (row) => [
    [0n, 1n, row], [0n, -1n, row],
    [3n * row, 5000n, 10000n * row], [3n * row, -5000n, 10000n * row],
    [-3n * row, 5000n, 10000n * row], [-3n * row, -5000n, 10000n * row]
];
// Cyrus-Beck with lambda fractions compared by cross-multiplication (positive denominators). Edges count as touches.
export function segHitsInt(T0, P0, T1, P1, k, j, row) {
    const [tc, pc2] = hexCentreInt(k, j, row);
    const x0 = T0 - tc, y0 = 2n * P0 - pc2, x1 = T1 - tc, y1 = 2n * P1 - pc2;
    let loN = 0n, loD = 1n, hiN = 1n, hiD = 1n;
    for (const [nt, np, c] of hexConstraintsInt(row)) {
        const num = c - (nt * x0 + np * y0), den = nt * (x1 - x0) + np * (y1 - y0);
        if (den === 0n) {
            if (num < 0n)
                return false;
        }
        else if (den > 0n) {
            if (num * hiD < hiN * den) {
                hiN = num;
                hiD = den;
            }
        }
        else if (-num * loD > loN * -den) {
            loN = -num;
            loD = -den;
        }
    }
    return loN * hiD <= hiN * loD;
}
// The contract's view of a column's tape (HexitGame._applyTape): touched bits, gap flag, contiguous chain end.
export class ColumnSim {
    k;
    row;
    bJ0;
    gapMs;
    tLo;
    tHi;
    chainTs = 0n;
    gap = false;
    touched = new Uint8Array(32); // bit (j - bJ0), LSB first within each byte
    constructor(k, row, bJ0, gapMs) {
        this.k = k;
        this.row = row;
        this.bJ0 = bJ0;
        this.gapMs = BigInt(gapMs);
        this.tLo = 5000n * k - 834n;
        this.tHi = 5000n * k + 5834n;
    }
    apply(T0, P0, T1, P1) {
        if (T1 < this.tLo || T0 > this.tHi)
            return;
        if (!this.gap) {
            if (T1 - T0 > this.gapMs)
                this.gap = true;
            else if (this.chainTs === 0n) {
                if (T0 > this.tLo)
                    this.gap = true;
            } // observation began inside the span
            else if (this.chainTs !== T0)
                this.gap = true; // a segment was missed
            if (!this.gap) {
                const lo = floorDiv(P0 < P1 ? P0 : P1, this.row) - 2n, hi = floorDiv(P0 < P1 ? P1 : P0, this.row) + 1n;
                const b0 = BigInt(this.bJ0), from = lo > b0 ? lo : b0, to = hi < b0 + 255n ? hi : b0 + 255n;
                for (let j = from; j <= to; j++) {
                    if (segHitsInt(T0, P0, T1, P1, this.k, j, this.row)) {
                        const i = Number(j - b0);
                        this.touched[i >> 3] |= 1 << (i & 7);
                    }
                }
            }
        }
        this.chainTs = T1;
    }
    outcome(j, marketLastTs) {
        const i = j - this.bJ0;
        if (i < 0 || i >= 256)
            throw new RangeError(`band ${j} outside column range`);
        if (this.touched[i >> 3] & (1 << (i & 7)))
            return 'WIN';
        if (this.gap)
            return 'VOID';
        if (this.chainTs >= this.tHi)
            return 'LOSS';
        return marketLastTs >= this.tHi + 2000n ? 'VOID' : 'PENDING';
    }
}
