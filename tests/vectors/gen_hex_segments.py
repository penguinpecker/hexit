"""Generate tests/vectors/hex_segments.json from the Python reference (research/pricing/hex_pricing.py).

Run from the repo root:  .venv/bin/python tests/vectors/gen_hex_segments.py
Deterministic (seeded). Every consumer (contracts/test/Vectors.t.sol, the TS pricing package) must reproduce every case.

Sections:
  seg     : seg_hits_int(T0,P0,T1,P1,k,j,ROW) -> hit           (the integer Cyrus-Beck test, verbatim)
  settle  : on-chain incremental column rule (HexitGame._applyTape) -> per (k, j) outcome,
            plus the reference settle() result for comparison (differs only where noted).
Prices are integers in 1e-8 USD, times are absolute unix ms on the 100 ms grid unless a case says otherwise.
"""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "research", "pricing"))
from hex_pricing import seg_hits_int, hex_centre_int, settle, seg_hits  # noqa: E402

ROWS = {"SOL": 5_000_000, "BTC": 2_500_000_000, "ETH": 50_000_000}   # $0.05, $25, $0.50 at 1e-8
GAP_MS = 250
K0 = 358_000_000            # a realistic absolute column index (2026: unix_ms / 5000 ~ 3.58e8); even
rng = np.random.default_rng(20261006)


def span(k):
    tc, _ = hex_centre_int(k, 0, 1)
    return tc - 3334, tc + 3334


def onchain_settle(ticks, k, j, ROW, gap_ms=GAP_MS):
    """HexitGame._applyTape: what the contract decides for a column from the ticks it was shown, in order.
    chain must start at a tick <= t_lo and be contiguous; any gap or late start -> VOID; touch before that -> WIN."""
    t_lo, t_hi = span(k)
    chain, gap, won = None, False, False
    for (T0, P0), (T1, P1) in zip(ticks, ticks[1:]):
        if T1 < t_lo or T0 > t_hi:
            if chain is not None:
                chain = T1          # contiguity is tracked even outside the span (only matters before t_hi)
            continue
        if won or gap:
            chain = T1
            continue
        if T1 - T0 > gap_ms:
            gap = True
        elif chain is None:
            if T0 <= t_lo:
                chain = T0
            else:
                gap = True          # observation started inside the span
        elif chain != T0:
            gap = True
        if not gap and seg_hits_int(T0, P0, T1, P1, k, j, ROW):
            won = True
        chain = T1
    if won:
        return "WIN"
    if gap:
        return "VOID"
    if chain is not None and chain >= t_hi:
        return "LOSS"
    return "PENDING"


def seg_cases():
    out = []
    # hand-picked edge cases (HEX.md section 4), ROW = 10, column 0 and an absolute even/odd column
    ROW = 10
    tc, pc2 = hex_centre_int(0, 0, ROW)
    hand = [
        ("top edge touches", tc, (pc2 + ROW) // 2, tc, (pc2 + ROW) // 2, 0, 0, ROW),
        ("just above top edge", tc, (pc2 + ROW + 2) // 2, tc, (pc2 + ROW + 2) // 2, 0, 0, ROW),
        ("slanted edge touches", tc + 2000, (pc2 + 8) // 2, tc + 2000, (pc2 + 8) // 2, 0, 0, ROW),
        ("just outside slanted edge", tc + 2001, (pc2 + 8) // 2, tc + 2001, (pc2 + 8) // 2, 0, 0, ROW),
        ("right tip point", tc + 3333, pc2 // 2, tc + 3333, pc2 // 2, 0, 0, ROW),
        ("past right tip", tc + 3334, pc2 // 2, tc + 3334, pc2 // 2, 0, 0, ROW),
        ("segment crossing whole hex horizontally", tc - 5000, pc2 // 2, tc + 5000, pc2 // 2, 0, 0, ROW),
        ("segment passing above", tc - 5000, pc2 // 2 + ROW, tc + 5000, pc2 // 2 + ROW, 0, 0, ROW),
        ("vertical segment through centre", tc, -10 * ROW, tc, 10 * ROW, 0, 0, ROW),
        ("diagonal clipping left tip corner", tc - 3400, pc2 // 2 - 1, tc - 3300, pc2 // 2 + 1, 0, 0, ROW),
        ("odd column centre (k=1,j=0)", 7500, ROW, 7500, ROW, 1, 0, ROW),
        ("odd column, point below band misses", 7500, -3, 7500, -3, 1, 0, ROW),
        ("negative band j=-3 centre", tc, (2 * -3 + 1) * ROW // 2, tc, (2 * -3 + 1) * ROW // 2, 0, -3, ROW),
    ]
    for name, T0, P0, T1, P1, k, j, R in hand:
        out.append(dict(name=name, T0=T0, P0=P0, T1=T1, P1=P1, k=k, j=j, row=R,
                        hit=bool(seg_hits_int(T0, P0, T1, P1, k, j, R))))
    # random segments near the hex, realistic absolute times and prices, every asset, both parities
    for asset, ROW in ROWS.items():
        for parity in (0, 1):
            k = K0 + parity
            j = int(rng.integers(1000, 4000))
            tc, pc2 = hex_centre_int(k, j, ROW)
            n_hit = 0
            for i in range(400):
                kind = i % 4
                T0 = tc + int(rng.integers(-4000, 4000))
                if kind == 0:   # 100 ms grid segment
                    T0 -= T0 % 100
                    T1 = T0 + 100
                elif kind == 1:  # longer (gap-length) segment
                    T1 = T0 + int(rng.integers(101, 3000))
                elif kind == 2:  # point
                    T1 = T0
                else:            # vertical
                    T1 = T0
                P0 = pc2 // 2 + int(rng.integers(-ROW, ROW + 1))
                P1 = P0 if kind == 2 else pc2 // 2 + int(rng.integers(-ROW, ROW + 1))
                hit = bool(seg_hits_int(T0, P0, T1, P1, k, j, ROW))
                n_hit += hit
                out.append(dict(name=f"rand {asset} k%2={parity} #{i}", T0=T0, P0=P0, T1=T1, P1=P1,
                                k=k, j=j, row=ROW, hit=hit))
            assert 40 < n_hit < 360, (asset, parity, n_hit)   # both outcomes well represented
    # self-check against the float reference (ties excluded): same check hex_pricing.main() runs
    mism = 0
    for c in out:
        tc, pc2 = hex_centre_int(c["k"], c["j"], c["row"])
        f = np.float64
        ff = bool(seg_hits(f(c["T0"] - tc) / 1000, f(2 * c["P0"] - pc2) / (2 * c["row"]),
                           f(c["T1"] - tc) / 1000, f(2 * c["P1"] - pc2) / (2 * c["row"]), "hex"))
        mism += ff != c["hit"]
    assert mism <= 6, mism            # float-tie cases on exact edges only
    return out


def brownian_ticks(t_start, n, p0, step_sd, gaps=()):
    ticks, p = [], p0
    for i in range(n):
        T = t_start + 100 * i
        p += int(round(rng.normal(0, step_sd)))
        if any(a <= T < b for a, b in gaps):
            continue
        ticks.append((T, p))
    return ticks


def settle_cases():
    out = []
    ROW = ROWS["SOL"]
    for case in range(40):
        k = K0 + (case % 2)
        t_lo, t_hi = span(k)
        start = t_lo - 1000 - 100 * int(rng.integers(0, 10))
        start -= start % 100
        gaps = []
        if case % 5 == 3:          # one gap inside the span
            g = t_lo + 100 * int(rng.integers(5, 55)); gaps = [(g, g + 400)]
        if case % 7 == 6:          # tape starts inside the span
            start = t_lo + 300
        n = int((t_hi + 1500 - start) / 100)
        if case % 11 == 10:        # tape ends before the span ends
            n = int((t_hi - 1500 - start) / 100)
        p0 = 12_000_000_000 + int(rng.integers(-ROW, ROW))
        ticks = brownian_ticks(start, n, p0, step_sd=ROW * 0.09, gaps=gaps)
        j_mid = p0 // ROW
        results = []
        for j in range(j_mid - 4, j_mid + 5):
            results.append(dict(j=j, onchain=onchain_settle(ticks, k, j, ROW),
                                reference=settle(ticks, k, j, ROW, gap_ms=GAP_MS)))
        for r in results:          # the two rules agree except where the on-chain rule is stricter
            if r["onchain"] != r["reference"]:
                assert r["onchain"] == "VOID" and (case % 7 == 6 or case % 11 == 10 or r["reference"] == "PENDING"), (case, r)
        out.append(dict(name=f"settle case {case}", k=k, row=ROW, gap_ms=GAP_MS,
                        ticks=[[T, P] for T, P in ticks], results=results))
    kinds = {r["onchain"] for c in out for r in c["results"]}
    assert {"WIN", "LOSS", "VOID"} <= kinds, kinds
    return out


def main():
    seg = seg_cases()
    st = settle_cases()
    doc = {
        "generated_by": "tests/vectors/gen_hex_segments.py (imports research/pricing/hex_pricing.py)",
        "units": {"T": "unix ms (int)", "P": "price, int, 1e-8 USD", "row": "band height, same units"},
        "hex": "column k: tc = 5000k+2500; pc2 = (2j+1)*row (k even) | (2j+2)*row (k odd); span tc +/- 3334",
        "seg": seg,
        "settle": st,
    }
    path = os.path.join(HERE, "hex_segments.json")
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"wrote {path}: {len(seg)} segment cases ({sum(c['hit'] for c in seg)} hits), "
          f"{len(st)} settle cases x 9 bands")


if __name__ == "__main__":
    main()
