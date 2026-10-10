# @hexit/pricing

Hexagon pricing engine and BigInt settlement mirror for Hexit (maths: `research/pricing/HEX.md`). TypeScript, ESM, no runtime dependencies.

```
npm install      # dev only: typescript 7.0.2
npm test         # node --test (Node >= 22.18 runs the .ts files directly)
npm run build    # tsc -> dist/index.js + index.d.ts
```

## What is in `src/index.ts`

| Part | Functions | Source |
|---|---|---|
| Solver | `hexU` (backward transfer-matrix solve over the hex lifetime, 100 ms ticks joined by straight lines, phase-averaged), `compact` (binning), `buildTable`, `TableCache` (6% log-sigma buckets) | straight port of the "pricing: exact hexagon touch" section of the earlier browser prototype, since removed |
| Price | `hexP`, `mixtureP` (vol scale mixture κ = 1, 1.5, 3 with weights 0.6, 0.3, 0.1), `round3Down`, `multX100` (uint16 ×100, rounded down, cap 10000, 0 = not offered below 101) | prototype |
| Volatility | `volInit`, `volStep` (one 100 ms tick, dP in USD), `sigmaUsd`, `volHot` | prototype |
| Quotes | `firstOpenColumn` (the on-chain lock: `5000k − 834 ≥ now + 5100 + 500`), `quoteColumn` (one Quote's `mults`, `uint16[64]`, for bands `qJ0..qJ0+63`), `quoteBoard` (18 columns, +1 column while `volHot`) | lock check and `Quote` in `contracts/src/HexitGame.sol` |
| Settlement | `segHitsInt` (integer Cyrus–Beck), `hexCentreInt`, `ColumnSim` (the column apply rule and outcome) | mirror of `contracts/src/HexGeo.sol` and `HexitGame._applyTape` |

Units: prices are `bigint` in 1e-8 USD, times are unix ms, `sigBands` is the volatility in bands/√s, and `d` is the distance from the price to the hex centre in bands.

Do not change the numerics here without measuring the change against `research/pricing/hex_pricing.py`. The contract, the quoter and this package must agree.

## Tests (`test/`)

- `pricing.test.ts`
  - Reference P values from `hex_pricing.py`, within 0.5%.
  - The prototype gate: the 810 cases in `tests/vectors/pricing_prototype.json`, P within 0.1% and `multX100` exact. The cases were saved from the prototype; the prototype and the script that made them have been removed, so the file is a fixed reference.
  - Rounding, cap and floor cases.
  - Sigma buckets.
- `hexgeo.test.ts`
  - Every seg case and every on-chain settle outcome in `tests/vectors/hex_segments.json`.
  - The float and integer segment tests agree.
  - Missing data refunds and is never a house win.
- `quote.test.ts`
  - The lock boundary to the millisecond.
  - The `uint16[64]` layout and band mapping for both column parities.
  - The vol floor and hot tape.
  - A timing benchmark for the full 18-column board.

## Known gaps

- At the prototype resolution (`nph=2, dxf=4`), the far-tail ETH cell (d=1, τ=12.6) prices at 0.00645, which is 0.73% above the Python solve (0.006403). It is still within the Monte Carlo result (0.00649 ± 0.00018). At `nph=8, dxf=8` it is 0.2% off. The other reference cells are within 0.1% at both resolutions.
- Tests are run by Node's type stripping and are not type-checked by `tsc`. Only `src/` is compiled.
