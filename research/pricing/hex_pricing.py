"""Hex tap-trading pricing + settlement, with a runnable self-check.

Units inside the maths: time in seconds relative to the hex centre tc,
price x in BAND units relative to the hex centre pc  (x = (p - pc) / row).
sig = price vol in bands per sqrt(second) = s / row, s = vol_ann * S / sqrt(YEAR).

Hex (flat-top, column pitch 5 s => circumradius R = 10/3 s), normalised
a = t/R, b = 2x:   |b| <= 1  and  2|a| + |b| <= 2.
Rectangle (a 5 s x 1 band box, same centre): a = t/2.5:  |a| <= 1, |b| <= 1.

Settlement rule priced here: oracle ticks every DT; WIN iff any straight
segment between consecutive ticks (endpoints included) meets the closed shape.

Run:  .venv/bin/python hex_pricing.py      (asserts; prints tables used in HEX.md)
"""
import time
from fractions import Fraction
import numpy as np
from scipy.special import ndtr

YEAR = 365 * 86400          # UNVERIFIED: year basis (365 vs 252)
R = 10.0 / 3.0              # hex circumradius in seconds
DT = 0.1                    # oracle tick interval (s)
BUFFER = 5.1                # first quoted cell starts >= 5.1 s after the quote
EDGE = 0.08                 # target house edge (business knob)
CAP, FLOOR = 100.0, 1.0
# Vol scale-mixture (fat tails / vol uncertainty). rms kappa = 1.47. UNVERIFIED calibration.
MIX = ((1.0, 0.6), (1.5, 0.3), (3.0, 0.1))
NPH = 8                     # tick phases averaged in the table

SHAPES = {
    "hex": (R, ((0, 1, 1), (0, -1, 1), (2, 1, 2), (2, -1, 2), (-2, 1, 2), (-2, -1, 2))),
    "rect": (2.5, ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1))),
}


def s_from_ann(vol_ann, S):
    return vol_ann * S / np.sqrt(YEAR)


def seg_hits(t0, x0, t1, x1, shape):
    """Vectorised Cyrus-Beck: does segment (t0,x0)->(t1,x1) meet the closed shape?"""
    half, cons = SHAPES[shape]
    a0, b0, a1, b1 = t0 / half, 2 * x0, t1 / half, 2 * x1
    da, db = a1 - a0, b1 - b0
    lo = np.zeros(np.broadcast(a0, b0, a1, b1).shape)
    hi = np.ones_like(lo)
    ok = np.ones(lo.shape, bool)
    eps = 1e-12
    with np.errstate(divide="ignore", invalid="ignore"):
        for na, nb, c in cons:
            num = c + eps - (na * a0 + nb * b0)
            den = na * da + nb * db
            r = num / den
            hi = np.where(den > 0, np.minimum(hi, r), hi)
            lo = np.where(den < 0, np.maximum(lo, r), lo)
            ok &= ~(np.asarray(den == 0) & np.asarray(num < 0))
    return ok & (lo <= hi)


def u_start(sig, shape, phi, dxf=8):
    """Backward transfer-matrix solve over the shape's lifetime.
    Ticks at t_n = -half - phi + n*DT. Returns grid x and u(x) = P(win | price x at t_0)."""
    half = SHAPES[shape][0]
    sd = sig * np.sqrt(DT)
    dx = 0.5 / np.ceil(0.5 * dxf / sd)     # cell edges land exactly on the flat edges |x| = 0.5
    L = 0.5 + 8 * sig * np.sqrt(2 * half + DT) + 5 * sd
    N = int(np.ceil(L / dx))
    x = (np.arange(-N, N) + 0.5) * dx       # cell centres
    K = int(np.ceil(7 * sd / dx))
    k = np.arange(-K, K + 1)
    w = ndtr((k + 0.5) * dx / sd) - ndtr((k - 0.5) * dx / sd)   # cell-integrated Gaussian
    idx = np.arange(x.size)[:, None] + k[None, :]
    valid = (idx >= 0) & (idx < x.size)
    idx = np.clip(idx, 0, x.size - 1)
    X0, X1 = x[:, None], x[:, None] + k[None, :] * dx
    t0 = -half - phi
    nseg = int(np.ceil((half - t0) / DT - 1e-9))
    u = np.zeros(x.size)
    for n in range(nseg - 1, -1, -1):
        ta = t0 + n * DT
        H = seg_hits(ta, X0, ta + DT, X1, shape)
        uj = np.where(valid, u[idx], 0.0)
        u = (w[None, :] * np.where(H, 1.0, uj)).sum(1)
    return x, u


class Table:
    """Per (sig, shape): u for NPH tick phases. P(d, tau) by Gaussian lead convolution.
    d = (pc - S0)/row (bands), tau = lead from now to the shape's EARLIEST point."""

    def __init__(self, sig, shape, nph=NPH, dxf=8):
        self.sig, self.shape = sig, shape
        self.phis = (np.arange(nph) + 0.5) / nph * DT
        self.us = [u_start(sig, shape, p, dxf) for p in self.phis]

    def P(self, d, tau):
        d, tau = np.broadcast_arrays(np.asarray(d, float), np.asarray(tau, float))
        out = np.zeros(d.shape)
        for phi, (x, u) in zip(self.phis, self.us):
            keep = u > 1e-15
            xs, us = x[keep], u[keep]
            dx = x[1] - x[0]
            sL = self.sig * np.sqrt(tau - phi)[..., None]
            xn = -d[..., None]
            out += (us * (ndtr((xs + dx / 2 - xn) / sL) - ndtr((xs - dx / 2 - xn) / sL))).sum(-1)
        return out / len(self.phis)


def u_bar(tab):
    """Collapse the NPH phase solutions into ONE array referenced to t_ref = earliest - DT:
    u_phi convolved with N(0, sig^2 (DT - phi)), averaged. Then P(d, tau) = u_bar (*) N(0, sig^2 (tau - DT)).
    This is the single array per sig that the server/JS ships."""
    x, _ = tab.us[0]
    dx = x[1] - x[0]
    acc = np.zeros(x.size)
    for phi, (_, u) in zip(tab.phis, tab.us):
        sv = tab.sig * np.sqrt(DT - phi)
        W = ndtr((x[None, :] + dx / 2 - x[:, None]) / sv) - ndtr((x[None, :] - dx / 2 - x[:, None]) / sv)
        acc += W @ u
    return x, acc / len(tab.us)


def P_from_ubar(x, ub, sig, d, tau):
    dx = x[1] - x[0]
    sL = sig * np.sqrt(np.asarray(tau, float) - DT)[..., None]
    xn = -np.asarray(d, float)[..., None]
    return (ub * (ndtr((x + dx / 2 - xn) / sL) - ndtr((x - dx / 2 - xn) / sL))).sum(-1)


class Model:
    """Mixture over vol scales; P is linear so mixture P = sum w_k P(kappa_k * sig)."""

    def __init__(self, sig, shape, mix=MIX):
        self.mix = mix
        self.tabs = [(wt, Table(sig * kap, shape)) for kap, wt in mix]

    def P(self, d, tau):
        return sum(wt * t.P(d, tau) for wt, t in self.tabs)


def round3_down(v):
    """3 significant figures, rounded DOWN (house-safe): 0.01 below 10x, 0.1 from 10x."""
    v = np.asarray(v, float)
    return np.where(v < 10, np.floor(v * 100 + 1e-9) / 100, np.floor(v * 10 + 1e-9) / 10)


def multiplier(P, edge=EDGE):
    raw = (1 - edge) / np.maximum(P, 1e-300)
    m = np.minimum(round3_down(np.minimum(raw, CAP)), CAP)
    offered = m >= 1.01                       # below 1.01 the bet cannot profit: do not offer
    return np.maximum(m, FLOOR), offered


def mc_hit(sig, shape, tau, d, n, rng, sub=1, jitter=False, points_only=False):
    """MC: exact Gaussian lead to first tick (uniform random phase), then ticks every DT
    (or U(0.05,0.15) if jitter), each tick interval split into `sub` straight segments."""
    half = SHAPES[shape][0]
    sig = np.broadcast_to(np.asarray(sig, float), (n,))
    tau = np.broadcast_to(np.asarray(tau, float), (n,))
    phi = rng.uniform(0, DT, n)
    x = -np.broadcast_to(np.asarray(d, float), (n,)) + sig * np.sqrt(tau - phi) * rng.standard_normal(n)
    t = -half - phi
    hit = np.zeros(n, bool)
    while t.min() <= half:
        step = rng.uniform(0.05, 0.15, n) if jitter else np.full(n, DT)
        h = step / sub
        for _ in range(sub):
            x1 = x + sig * np.sqrt(h) * rng.standard_normal(n)
            if points_only:
                hit |= seg_hits(t, x, t, x, shape)
            else:
                hit |= seg_hits(t, x, t + h, x1, shape)
            x, t = x1, t + h
    if points_only:
        hit |= seg_hits(t, x, t, x, shape)
    return hit


# ---------------- exact integer settlement (on-chain / JS BigInt reference) ----------------
def hex_constraints_int(ROW):
    """Constraints n_t*dt + n_p*dp2 <= c, dt in ms from tc, dp2 = 2*(p - pc) in price units."""
    return ((0, 1, ROW), (0, -1, ROW),
            (3 * ROW, 5000, 10000 * ROW), (3 * ROW, -5000, 10000 * ROW),
            (-3 * ROW, 5000, 10000 * ROW), (-3 * ROW, -5000, 10000 * ROW))


def hex_centre_int(k, j, ROW):
    """Column k (absolute timeIndex: start = 5000k ms), band j. Returns tc_ms, pc2 (= 2*pc)."""
    return 5000 * k + 2500, (2 * j + 1) * ROW if k % 2 == 0 else (2 * j + 2) * ROW


def seg_hits_int(T0, P0, T1, P1, k, j, ROW):
    """Integers only: ticks (T ms, P price units). Fractions lambda = num/den compared by cross-mult."""
    tc, pc2 = hex_centre_int(k, j, ROW)
    x0, y0, x1, y1 = T0 - tc, 2 * P0 - pc2, T1 - tc, 2 * P1 - pc2
    lo_n, lo_d, hi_n, hi_d = 0, 1, 1, 1
    for nt, npp, c in hex_constraints_int(ROW):
        num = c - (nt * x0 + npp * y0)
        den = nt * (x1 - x0) + npp * (y1 - y0)
        if den == 0:
            if num < 0:
                return False
        elif den > 0:                       # lambda <= num/den
            if num * hi_d < hi_n * den:
                hi_n, hi_d = num, den
        else:                               # lambda >= num/den  (flip to positive den)
            if -num * lo_d > lo_n * -den:
                lo_n, lo_d = -num, -den
    return lo_n * hi_d <= hi_n * lo_d


def settle(ticks, k, j, ROW, gap_ms=1000):
    """ticks: sorted list of (T ms, P int). Returns 'WIN' | 'LOSS' | 'VOID' | 'PENDING'."""
    tc, _ = hex_centre_int(k, j, ROW)
    t_lo, t_hi = tc - 3334, tc + 3334       # hex span tc +/- 3333.3 ms, rounded outward
    covered = False
    for (T0, P0), (T1, P1) in zip(ticks, ticks[1:]):
        if T1 < t_lo or T0 > t_hi:
            continue
        if T1 - T0 > gap_ms:                # unobserved interval overlapping the hex
            return "VOID"                   # (a WIN already found earlier returned first)
        if seg_hits_int(T0, P0, T1, P1, k, j, ROW):
            return "WIN"
    if ticks and ticks[0][0] <= t_lo and ticks[-1][0] >= t_hi:
        covered = True
    return "LOSS" if covered else "PENDING"


# ------------------------------------------ self-check ------------------------------------------
def main():
    rng = np.random.default_rng(7)
    t_start = time.time()
    assets = {
        "SOL": dict(S=120.45, row=0.05, vol=0.65),
        "ETH": dict(S=2712.3, row=0.5, vol=0.0464),
    }
    for a in assets.values():
        a["s"] = s_from_ann(a["vol"], a["S"])
        a["sig"] = a["s"] / a["row"]
    print("vol in bands/sqrt(s):", {k: round(v["sig"], 4) for k, v in assets.items()},
          " $/sqrt(s):", {k: round(v["s"], 5) for k, v in assets.items()})

    # 1. integer settlement vs float, and edge cases
    ROW = 10
    tc, pc2 = hex_centre_int(0, 0, ROW)     # tc=2500 ms, pc=ROW/2 (pc2=ROW)
    P = lambda dp2: (pc2 + dp2) // 2 if (pc2 + dp2) % 2 == 0 else None
    # points exactly on edges (pc2 even so P integer when dp2 even)
    assert seg_hits_int(tc, (pc2 + ROW) // 2, tc, (pc2 + ROW) // 2, 0, 0, ROW)            # top edge
    assert not seg_hits_int(tc, (pc2 + ROW + 2) // 2, tc, (pc2 + ROW + 2) // 2, 0, 0, ROW)
    assert seg_hits_int(tc + 2000, (pc2 + 8) // 2, tc + 2000, (pc2 + 8) // 2, 0, 0, ROW)  # slanted edge
    assert not seg_hits_int(tc + 2001, (pc2 + 8) // 2, tc + 2001, (pc2 + 8) // 2, 0, 0, ROW)
    # odd column is shifted up half a band
    assert hex_centre_int(1, 0, ROW) == (7500, 2 * ROW)
    # random segments: integer vs float agree
    ROWb = 5_000_000                         # $0.05 at 1e-8 price units
    m = 0
    for _ in range(20000):
        T0 = int(rng.integers(-5000, 5000)) + tc
        T1 = T0 + int(rng.integers(50, 200))
        P0, P1 = [int(v) for v in rng.integers(-ROWb, 2 * ROWb, 2)]
        fi = seg_hits_int(T0, P0, T1, P1, 0, 0, ROWb)
        pcb = ROWb / 2
        ff = bool(seg_hits((T0 - tc) / 1000, (P0 - pcb) / ROWb, (T1 - tc) / 1000, (P1 - pcb) / ROWb, "hex"))
        m += fi != ff
    assert m <= 2, m                         # float tie cases only
    # every plane point in exactly one hex (dense lattice sample)
    ts = rng.uniform(0, 50, 20000); ps = rng.uniform(0, 5, 20000)
    cnt = np.zeros(ts.size, int)
    for kk in range(-1, 12):
        for jj in range(-2, 8):
            tcf = 5 * kk + 2.5; pcf = jj + (0.5 if kk % 2 == 0 else 1.0)
            cnt += seg_hits(ts - tcf, ps - pcf, ts - tcf, ps - pcf, "hex")
    assert (cnt == 1).mean() > 0.999, (cnt == 1).mean()   # boundary points may count twice
    # settle(): win / loss / void
    tk = [(T, (pc2 + 4 * ROW) // 2) for T in range(-1000, 7000, 100)]   # far above: loss
    assert settle(tk, 0, 0, ROW) == "LOSS"
    tk2 = tk[:30] + [(2000, pc2 // 2)] + tk[31:]
    assert settle(sorted(tk2), 0, 0, ROW) == "WIN"
    tk3 = [t for t in tk if not (1000 < t[0] < 3000)]
    assert settle(tk3, 0, 0, ROW) == "VOID"
    print("settlement checks OK")

    # 2. PDE grid convergence (dx and phase count)
    conv = []
    for name, A in assets.items():
        sig = A["sig"]
        t8, t16 = Table(sig, "hex", 8, 8), Table(sig, "hex", 16, 16)
        for d, tau in [(0.0, 7.6), (0.5, 7.6), (1.5, 32.6)]:
            p8, p16 = float(t8.P(d, tau)), float(t16.P(d, tau))
            conv.append((name, d, tau, p8, p16, abs(p8 - p16) / p16))
    print("\nconvergence dx=sd/8,8ph vs sd/16,16ph:")
    for c in conv:
        print("  %s d=%.1f tau=%.1f  %.6f %.6f rel %.2e" % c)
    assert max(c[5] for c in conv) < 1e-3

    # 3. PDE vs MC, 16 cells, 200k paths each, pure BM (kappa=1)
    print("\nPDE vs MC (tick-segment rule, 200k paths):")
    N = 200_000
    worst_abs = worst_rel = worst_z = 0
    rows = []
    for name, A in assets.items():
        sig = A["sig"]
        tabs = {sh: Table(sig, sh) for sh in ("hex", "rect")}
        cells = [("hex", 0.0, 7.6), ("hex", 0.5, 7.6), ("hex", 1.0, 12.6), ("hex", -1.5, 22.6),
                 ("hex", 0.25, 32.6), ("hex", 3.0 if name == "SOL" else 1.0, 92.6),
                 ("rect", 0.0, 8.43), ("rect", 1.0, 33.43)]
        for sh, d, tau in cells:
            pp = float(tabs[sh].P(d, tau))
            hit = mc_hit(sig, sh, tau, d, N, rng, sub=1)
            pm = hit.mean(); se = np.sqrt(max(pm * (1 - pm), 1e-12) / N)
            z = (pp - pm) / se
            worst_abs = max(worst_abs, abs(pp - pm)); worst_rel = max(worst_rel, abs(pp - pm) / pm)
            worst_z = max(worst_z, abs(z))
            rows.append((name, sh, d, tau, pp, pm, se, z))
            print("  %s %-4s d=%+.2f tau=%5.2f  P_pde=%.5f P_mc=%.5f se=%.5f z=%+.2f" % rows[-1])
            assert abs(z) < 4.5, rows[-1]
    big = [r for r in rows if r[5] > 0.01]
    print("  max |abs err| %.5f  max |z| %.2f  max rel err (P>0.01) %.4f"
          % (worst_abs, worst_z, max(abs(r[4] - r[5]) / r[5] for r in big)))
    # u_bar collapse is exact (same P as phase-averaged Table.P)
    for name, A in assets.items():
        tb = Table(A["sig"], "hex"); xb, ub = u_bar(tb)
        for d, tau in [(0.0, 7.6), (0.5, 12.6), (1.5, 92.6)]:
            a1, a2 = float(tb.P(d, tau)), float(P_from_ubar(xb, ub, A["sig"], d, tau))
            assert abs(a1 - a2) < 1e-6 + 1e-4 * a1, (name, d, tau, a1, a2)
    print("  u_bar single-array collapse == phase-averaged P: OK")

    # 4. tick-rule vs continuous BM vs points-only vs jittered ticks
    print("\nsettlement-rule sensitivity (200k paths, same cell set):")
    for name, A in assets.items():
        sig = A["sig"]
        for d, tau in [(0.5, 7.6), (1.0, 12.6)]:
            seg = mc_hit(sig, "hex", tau, d, N, rng).mean()
            cont = mc_hit(sig, "hex", tau, d, N, rng, sub=20).mean()
            pts = mc_hit(sig, "hex", tau, d, N, rng, points_only=True).mean()
            jit = mc_hit(sig, "hex", tau, d, N, rng, jitter=True).mean()
            print("  %s d=%.1f tau=%.1f  seg100ms=%.4f  cont~5ms=%.4f  points=%.4f  jitter=%.4f"
                  % (name, d, tau, seg, cont, pts, jit))

    # 5. multiplier tables: hex vs rect, mixture model, first 6 quoted columns
    out = {}
    for name, A in assets.items():
        hexm, rectm = Model(A["sig"], "hex"), Model(A["sig"], "rect")
        offs = np.arange(-6, 7)
        taus_h = BUFFER + 2.5 + 5 * np.arange(6)          # earliest-point lead, mid phase
        taus_r = taus_h + R - 2.5                          # same centre
        D, TH = np.meshgrid(offs / 2, taus_h, indexing="ij")
        _, TR = np.meshgrid(offs / 2, taus_r, indexing="ij")
        Mh, oh = multiplier(hexm.P(D, TH)); Mr, orr = multiplier(rectm.P(D, TR))
        out[name] = (hexm, rectm)
        print("\n%s multipliers hex/rect (mixture, edge %.0f%%), rows = offset (half-bands), cols = quoted col 1..6"
              % (name, EDGE * 100))
        print("  off | " + " | ".join("c%d tc+%.1fs" % (i + 1, t + R) for i, t in enumerate(taus_h)))
        for i, o in enumerate(offs):
            cells = []
            for c in range(6):
                fh = "%g" % Mh[i, c] if oh[i, c] else "--"
                fr = "%g" % Mr[i, c] if orr[i, c] else "--"
                cells.append("%s/%s" % (fh, fr))
            print("  %+3d | " % o + " | ".join(cells))

    # 6. realised house edge: random bets priced by the mixture, settled by MC tick-segment
    print("\nrealised edge (mixture paths, tick-segment settlement):")
    NB = 300_000
    for name, A in assets.items():
        hexm = out[name][0]
        Dmax = 3.0 if name == "SOL" else 1.0
        col = rng.integers(0, 18, NB)
        tau = BUFFER + rng.choice([0.0, 1.25, 2.5, 3.75], NB) + 5 * col
        d = rng.uniform(-Dmax, Dmax, NB)
        # price via a fine (d, tau) lattice + linear interp in d (tau is on a discrete set)
        ugrid = np.unique(tau)
        dg = np.linspace(-Dmax - 0.05, Dmax + 0.05, 801)
        Pg = {tv: hexm.P(dg, np.full(dg.size, tv)) for tv in ugrid}
        Pb = np.empty(NB)
        for tv in ugrid:
            s = tau == tv
            Pb[s] = np.interp(d[s], dg, Pg[tv])
        M, off = multiplier(Pb)
        kap = np.array([k for k, _ in MIX]); wts = np.array([w for _, w in MIX])
        kp = rng.choice(kap, NB, p=wts)
        hit = mc_hit(A["sig"] * kp, "hex", tau, d, NB, rng)
        pay = np.where(off & hit, M, 0.0); stake = off.astype(float)
        realised = 1 - pay.sum() / stake.sum()
        se = pay[off].std() / np.sqrt(off.sum())
        expected = 1 - (M * Pb)[off].mean()
        unc = off & (M < CAP)
        exp_unc = 1 - (M * Pb)[unc].mean()
        real_unc = 1 - pay[unc].sum() / unc.sum()
        se_unc = pay[unc].std() / np.sqrt(unc.sum())
        print("  %s bets=%d offered=%.1f%% capped=%.1f%%  expected=%.4f realised=%.4f +/- %.4f (1se)"
              "  | uncapped: expected=%.4f realised=%.4f +/- %.4f  target=%.2f"
              % (name, NB, 100 * off.mean(), 100 * (off & (M >= CAP)).mean(), expected, realised, se,
                 exp_unc, real_unc, se_unc, EDGE))
        assert abs(realised - expected) < 4 * se
        assert abs(real_unc - exp_unc) < 4 * se_unc
        assert EDGE <= exp_unc < EDGE + 0.02

    # 7. browser cost proxy: one full 18 x 100 grid evaluation from cached u
    hexm = out["SOL"][0]
    DD, TT = np.meshgrid(np.arange(-50, 50) / 2, BUFFER + 2.5 + 5 * np.arange(18), indexing="ij")
    t0 = time.time(); hexm.P(DD, TT); dt = time.time() - t0
    nu = sum(int((u > 1e-15).sum()) for _, t in hexm.tabs for _, u in t.us)
    print("\nfull 18x100 grid from cached u: %.3fs numpy (%d u-points x 1800 cells x erf pairs)" % (dt, nu))
    print("ALL CHECKS PASSED in %.0fs" % (time.time() - t_start))


if __name__ == "__main__":
    main()
