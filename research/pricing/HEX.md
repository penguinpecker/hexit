# Hex tap trading: pricing and settlement maths

Runnable check: `.venv/bin/python hex_pricing.py`. It runs every assertion below in about 130 s and prints all the numbers in this file. Output is in `run.log`.
Data: synthetic Brownian motion only. The SOL and ETH inputs below are example values.

## 0. Geometry (fixed by the UI)

- Columns are 5 s apart. Column k has the absolute index `timeIndex` and nominal window [5k, 5k+5]. Its centre is tc = 5k + 2.5.
- Hex circumradius in time: R = 10/3 s. A row is one price band (`row`).
- Even column k: hex centre pc = (j + ½)·row. **Odd** column k: pc = (j + 1)·row.
- Parity must use the absolute `timeIndex`, not the on-screen position. Otherwise the pattern flips every 5 s.
- Normalised coordinates: a = (t − tc)/R and b = (p − pc)/(row/2). The hex is then

  **|b| ≤ 1 and 2|a| + |b| ≤ 2**

  Vertices are (±1, 0) and (±½, ±1). The flat top and bottom run over tc ± 5/3 s. The tips are at tc ± 10/3 s.
- A hex has the same area as the rectangle (5 s × row), so the tiling has the same density.
- Checked: 20k random points in the plane each fall in exactly one hex (> 99.9%; the rest lie exactly on shared edges).

## 1. Payoff semantics: decision (b), the bet is the exact hex

The bet WINS iff the settled price path (t, p(t)) enters the closed hexagon.

Option (a) would draw a hex but settle on the rectangle, and that is rejected. Near the tips the hex covers time outside the rectangle, and the rectangle's corners lie outside the hex. Under (a), a visible line crossing a hex tip would lose, and a win could be paid with the line visibly outside the hex. Disputes are guaranteed, and the multiplier would not describe what the user sees.

Consequences:

- **Time ownership.** Hex k spans [5k − 0.833, 5k + 5.833].
  - In [5k + 0.833, 5k + 4.167], only column k's hexes hold time.
  - In each 1.667 s seam, column k−1 and column k share the time. The slanted edges split the seam by price, so every (t, p) still has exactly one owner.
  - One path can touch hexes in two adjacent columns at the same instant. Each is a separate bet.
- **Lock / no-bet rule.** Measure from the hex's **earliest point** (left tip, tc − R = 5k − 0.833), not from the column start.
  - Buffer: the first quoted cell starts ≥ 5.1 s after the quote. The current column and the next are never offered.
  - Hex rule: offer column k iff `5k − 0.833 ≥ now + 5.1`, i.e. column start ≥ now + 5.93 s.
  - The server re-checks this with its own clock when it receives the bet. A hex is never partly in the past when bet.
- **Resolution time.** A WIN is final at the first touching segment. A LOSS can only be declared once there is a tick at or after tc + R = 5k + 5.833, which is 0.83 s after the column's nominal end.
- The table is indexed by τ = lead to the earliest point, and by d = (pc − S₀)/row in bands. Even and odd columns use the **same** table, because they differ only in which d values occur.

## 2. Pricing P(hit hex)

Model: driftless Brownian motion in band units, σ = s/row (bands/√s), with s = vol_ann·S/√(365·86400).
UNVERIFIED: the 365-day year basis.

- SOL (S = 120.45, row 0.05, 65%): s = 0.01394 $/√s, σ = 0.2788 bands/√s.
- ETH (S = 2712.3, row 0.5, vol 0.0464): s = 0.02241 $/√s, σ = 0.0448 bands/√s.

**Fat tails.** Real prices jump more often than plain BM allows.
- So the house uses a vol **scale mixture**: P = Σ wₖ·P_BM(κₖσ), with κ = {1, 1.5, 3} and w = {0.6, 0.3, 0.1}. The rms κ is 1.47.
- P is linear in the mixture, so this costs 3 tables.
- UNVERIFIED: the mixture weights are a design choice. They have not been calibrated on real price data.

### What is priced: the real settlement rule

Settlement uses ticks every 0.1 s, and the straight segments between them, tested against the hex. Monte Carlo, 200k paths per cell:

| cell | 100 ms segments (priced) | continuous BM (5 ms) | tick points only | jittered ticks U(50,150) ms |
|---|---|---|---|---|
| SOL d=0.5, τ=7.6 | 0.6115 | 0.6323 (+3.4%) | 0.6091 | 0.6084 |
| SOL d=1.0, τ=12.6 | 0.4178 | 0.4394 (+5.2%) | 0.4171 | 0.4188 |
| ETH d=0.5, τ=7.6 | 0.6513 | 0.6669 (+2.4%) | 0.6493 | 0.6507 |
| ETH d=1.0, τ=12.6 | 0.0064 | 0.0071 (+11%) | 0.0062 | 0.0067 |

- Pricing on continuous BM would overstate P by 2–11%, which hides extra edge and mis-states the multiplier. So the solver models the tick-and-segment rule **exactly**, and no separate continuity correction is needed.
- The segment test adds about 0.3% over testing tick points only, mostly at the slanted edges.
- Jittered ticks changed P by up to 0.5%, which is within about 3 standard errors. UNVERIFIED for the real oracle's tick timing.

### Solver: one backward solve per σ gives every cell

Hexes in a column differ only by a vertical shift, so one backward solve gives u(x) = P(win | price x at the first tick) for all offsets at once.

- **Grid.** Cell-centred x grid with dx = 0.5/⌈0.5·8/(σ√Δ)⌉, about σ√Δ/8. The cell edges land exactly on |x| = ½. Domain ±(0.5 + 8σ√(2R+Δ) + 5σ√Δ).
- **Kernel.** Banded transition kernel K_k = Φ((k+½)dx/σ√Δ) − Φ((k−½)dx/σ√Δ), for |k| ≤ 7σ√Δ/dx. That is about 113 bands. The Gaussian steps are exact, with no Crank–Nicolson time error.
- **Backward recursion** over the ticks tₙ = tc − R − φ + nΔ, about 68 steps:
  `u_n(x_i) = Σ_k K_k · ( segment (tₙ, x_i)→(tₙ₊₁, x_{i+k}) meets hex ? 1 : u_{n+1}(x_{i+k}) )`, starting from u = 0 after the last tick.
- **Tick phase.** Average φ over 8 phases in [0, Δ). Then collapse them into one array, ū = mean_φ [u_φ ⊛ N(0, σ²(Δ−φ))], referenced to t_ref = earliest − Δ.
- **Lead time.** Then for any lead τ:

  **P(d, τ) = Σ_i ū_i [Φ((x_i + dx/2 + d)/σ√(τ−Δ)) − Φ((x_i − dx/2 + d)/σ√(τ−Δ))]**

  The collapse is checked to be exact against the per-phase average.
- **Accuracy.** Comparing dx = σ√Δ/8 with 8 phases against σ√Δ/16 with 16 phases, the relative difference in P is ≤ 1.7e-4 for P > 0.01, and 9e-4 at P = 2e-4. This meets the < 0.1% target.
  - Before the cell edges were aligned to the band edges, a grid-point mask gave errors of 0.15–0.6% that jumped around as dx changed. Keep the alignment.

### Monte Carlo verification

16 cells, 200k paths each, tick-and-segment rule, random tick phase:

| asset | shape | d | τ | P_pde | P_mc | z |
|---|---|---|---|---|---|---|
| SOL | hex | 0 | 7.6 | 0.68387 | 0.68522 | −1.31 |
| SOL | hex | +0.5 | 7.6 | 0.61065 | 0.60888 | +1.63 |
| SOL | hex | +1 | 12.6 | 0.41991 | 0.41919 | +0.65 |
| SOL | hex | −1.5 | 22.6 | 0.28946 | 0.28873 | +0.72 |
| SOL | hex | +0.25 | 32.6 | 0.40663 | 0.40621 | +0.37 |
| SOL | hex | +3 | 92.6 | 0.14374 | 0.14319 | +0.70 |
| SOL | rect | 0 | 8.43 | 0.71364 | 0.71301 | +0.62 |
| SOL | rect | +1 | 33.43 | 0.36725 | 0.36632 | +0.87 |
| ETH | hex | 0 | 7.6 | 0.99991 | 0.99994 | −1.35 |
| ETH | hex | +0.5 | 7.6 | 0.65199 | 0.65372 | −1.63 |
| ETH | hex | +1 | 12.6 | 0.00640 | 0.00649 | −0.46 |
| ETH | hex | −1.5 | 22.6 | 0.00002 | 0.00001 | +2.56 (about 2 hits) |
| ETH | hex | +0.25 | 32.6 | 0.87413 | 0.87362 | +0.69 |
| ETH | hex | +1 | 92.6 | 0.15593 | 0.15595 | −0.02 |
| ETH | rect | 0 | 8.43 | 0.99996 | 0.99996 | +0.66 |
| ETH | rect | +1 | 33.43 | 0.05421 | 0.05364 | +1.12 |

- Max absolute error: 0.0018.
- Max relative error: 1.05% for P > 0.01, which is the 0.0064 cell where the standard error is 2.8%. It is 0.29% for P > 0.1.
- Max |z|: 2.56. All cells pass the assertion |z| < 4.5.

## 3. Multiplier

**M = round3_down(min((1 − e)/P, 100))**

- Round to 3 significant figures: 0.01 steps below 10×, 0.1 steps from 10× up. **Round down**, because it is house-safe and adds at most 0.9% edge, at M ≈ 1.1.
- Cap 100. Floor 1.00.
- Cells with M < 1.01 are **not offered** (shown as `--`). At 1.00 the player can only lose.
- Target edge e = 0.08 is a business setting.

Tables below:
- Shown as hex/rect, using the mixture model.
- Rect = the rectangle with the same centre.
- Rows = offset of the hex centre from the current price, in half-bands.
- Columns = first 6 quoted columns, taken mid-phase: the earliest point is 7.6 s ahead and the centre 10.9 s ahead for c1.

SOL (row $0.05, 65%):

| off | c1 | c2 | c3 | c4 | c5 | c6 |
|---|---|---|---|---|---|---|
| ±6 | 14.9/14.5 | 11/10.7 | 9.12/8.81 | 8/7.72 | 7.3/7.04 | 6.85/6.6 |
| ±5 | 8.84/8.51 | 6.93/6.67 | 6.04/5.81 | 5.55/5.34 | 5.27/5.07 | 5.11/4.91 |
| ±4 | 5.09/4.87 | 4.4/4.22 | 4.11/3.95 | 3.99/3.83 | 3.95/3.79 | 3.95/3.79 |
| ±3 | 3.04/2.92 | 2.95/2.83 | 2.96/2.85 | 3.02/2.91 | 3.11/2.98 | 3.2/3.07 |
| ±2 | 2.02/1.95 | 2.16/2.08 | 2.31/2.22 | 2.46/2.36 | 2.6/2.5 | 2.74/2.63 |
| ±1 | 1.56/1.51 | 1.78/1.72 | 1.98/1.91 | 2.16/2.08 | 2.33/2.24 | 2.49/2.39 |
| 0 | 1.43/1.38 | 1.67/1.61 | 1.88/1.81 | 2.07/1.99 | 2.25/2.16 | 2.41/2.31 |

ETH (row $0.50, vol 0.0464):

| off | c1 | c2 | c3 | c4 | c5 | c6 |
|---|---|---|---|---|---|---|
| ±4..6 | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 |
| ±3 | 100/100 | 100/100 | 99.6/89 | 74.7/67.6 | 59.8/54.6 | 49.9/45.7 |
| ±2 | 28.3/24.6 | 18.9/16.8 | 14.2/12.8 | 11.5/10.5 | 9.79/8.98 | 8.59/7.93 |
| ±1 | 1.41/1.33 | 1.47/1.4 | 1.51/1.44 | 1.54/1.48 | 1.57/1.51 | 1.59/1.53 |
| 0 | -- | -- | -- | -- | -- | 1.02/1.01 |

- Hex multipliers are 3–5% above rectangle ones near the price, and up to about 12% higher at 1–1.5 bands. The hex has the same area but less full-height time (3.33 s against 5 s).
- In the quiet ETH sample the price's own band is a near-certain touch, so it is not offered.

**Realised house edge** (`main` step 6). 300k random hex bets per asset:
- Setup: columns 1–18, 4 lead phases, d uniform in ±3 bands (SOL) or ±1 band (ETH).
- Each bet is priced by the mixture, settled by MC paths drawn from the same mixture, with the tick-and-segment rule.

| asset | expected edge (with rounding/cap) | realised ± 1 se | target |
|---|---|---|---|
| SOL | 0.0813 | 0.0795 ± 0.0031 | 0.08 |
| ETH | 0.0826 | 0.0816 ± 0.0024 | 0.08 |

Both are within 1 standard error. Rounding down adds 0.13–0.26% of edge. No sampled bet hit the cap: with these offset ranges the cap gives extra edge only on far cells.

## 4. Settlement algorithm (on-chain and JS, integers only)

Inputs:
- Ticks (T in ms, P in integer price units).
- `ROW` = band in the same units.
- Column k, band j.

Derived values:
- tc = 5000k + 2500 ms.
- pc2 = 2·pc = (2j+1)·ROW if k is even, (2j+2)·ROW if k is odd.
- With dt = T − tc and dp2 = 2P − pc2, the hex is 6 integer half-planes n_t·dt + n_p·dp2 ≤ c:
  - (0, ±1, ROW)
  - (±3·ROW, ±5000, 10000·ROW), all four sign pairs

Segment test (Cyrus–Beck, with no division):
- For each half-plane, compute num = c − n·(dt₀, dp2₀) and den = n·(Δdt, Δdp2).
  - den = 0 and num < 0: miss.
  - den > 0: λ ≤ num/den, so tighten hi.
  - den < 0: λ ≥ num/den, so tighten lo.
- Keep lo and hi as fractions, starting at 0/1 and 1/1. Compare fractions by cross-multiplying with positive denominators.
- Hit iff lo ≤ hi. A degenerate segment (T0 = T1, P0 = P1) is a point test.
- Size: |3·ROW·dt| ≲ 3·5e7·1e4 = 1.5e12, and cross products ≲ 1e25. That fits in int256 (the contract's `HexGeo`) and BigInt.

Rules:
- A point on an edge counts as a touch, because all inequalities are ≤. Checked: top edge (dt 0, dp2 = ROW) hits and ROW+2 misses; slanted edge (ROW=10, dt=2000, dp2=8) hits and dt=2001 misses.
- Odd column shift checked: `hex_centre_int(1,0,ROW) == (7500, 2·ROW)`.
- Integer test agrees with the float test on 20k random segments (≤ 2 float tie cases allowed).
- `settle(ticks,k,j,ROW,gap_ms=1000)` scans the segments that overlap [tc − 3334, tc + 3334] ms, in time order:
  - first touching segment: **WIN** (early settle);
  - a segment with ΔT > gap_ms overlapping the span, before any touch: **VOID** (refund). A straight line across a data gap is not an observation;
  - no touch, and ticks exist both ≤ span start and ≥ span end: **LOSS**;
  - otherwise **PENDING**.
- `gap_ms = 1000` is a placeholder (UNVERIFIED against the oracle's real gap statistics).
- Hexes partly in the past cannot be bet (§1 lock rule).
- The quoted multiplier is fixed at acceptance (server-signed quote id), and the server is authoritative.

## 5. Precompute and runtime (the server streams prices; JS mirrors them for display)

- **What to store.** For each asset and each mixture component κ: one array ū(x; κσ). Its length is about 1–2k floats, cut where ū < 1e-15.
  - P depends on σ only (R and Δ are fixed), so ship a library of ū over a log-σ grid with 2% steps. For σ from 0.02 to 3 bands/√s, that is about 250 arrays × ~2k float32, about 2 MB.
  - Alternatively, the server computes ū when σ moves by more than 2% and pushes it.
  - Snap σ to the grid; there is no interpolation across σ.
- **Building one ū** = 8 phases × about 68 steps × N·(2K+1) ≈ 1.1k·113 mask-and-sum operations. That is about 1–3 s of numpy, so do it offline or on the server, not in the browser.
- **Per frame** (5 Hz, 18 columns × ~100 half-band offsets = 1800 cells): P = Σ_κ w_κ (ū_κ ⊛ Gaussian)(−d).
  - Direct erf evaluation: about 26k ū points × 1800 cells = 47M erf pairs. That measured 0.69 s in numpy, which is too slow per frame.
  - **Do this instead:** when σ changes, precompute P_κ[τ][d] by FFT convolution, one per τ.
    - τ in 0.1 s steps over 5–100 s (950 rows), d in the same dx grid.
    - Cost ≈ 3 × 950 FFTs of 4096 points ≈ 1.5e8 flops, about 0.1–0.3 s in a Web Worker.
  - Each frame is then 1800 bilinear lookups (τ, d), which is well under 1 ms.
  - Browser timings are estimates (UNVERIFIED: not measured in JS).
- **Interpolation error.** Linear in d at dx ≈ σ√Δ/8 is negligible. The error from linear interpolation in τ at 0.1 s steps was not measured (UNVERIFIED).
- **Per frame (1–6):**
  1. now, S₀.
  2. For each quoted column k (lock rule §1): τ = 5k − 0.833 − now.
  3. For each band j: d = (pc(k, j) − S₀)/row.
  4. P = Σ w·lookup.
  5. M from §3.
  6. Render; `--` when M < 1.01.

## UNVERIFIED summary

- The year basis (365 or 252 days).
- The mixture weights. They need calibrating on real price data.
- The real oracle's tick timing and gaps (jitter ±50 ms moved P by up to 0.5%).
- The `gap_ms` value and the browser timings.
