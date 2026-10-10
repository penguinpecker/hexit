# HexitGame gas (re-measured 2026-10-10 for the markets upgrade: BTC and MON)

**Where:** a local `anvil --network monad` (Foundry 1.8.5, MonadTen gas rules with MIP-8 storage pages). Production
build: solc 0.8.37, `via_ir`, 200 optimizer runs. Nothing was sent to Monad testnet.

**How:**
- `./gas.sh` starts its own anvil and deploys with `script/Deploy.s.sol`, which now includes `initializeMarkets`.
  It then runs `script/GasBench.s.sol` in four phases (prep, bets, settle, money) and reads `gasUsed` from the
  broadcast receipts.
- `./rehearse-upgrade.sh` runs the same bench on a local fork of testnet, after `script/Upgrade.s.sol` has upgraded
  the live proxy (fork block 69,622,068).
- Each figure includes the 21,000 base cost, calldata and the proxy's overhead. It is the highest of 3 `gas.sh` runs
  plus the fork run.
- Both markets were measured at their first rows, before the 2026-10-10 band cut to $5 and $0.00001. Smaller bands let a busy tape touch more bands, which costs more settle gas; the keeper simulates every settle and goes above the table when it must:
  - BTC (asset 1): row $25, priced at $82,385;
  - MON (asset 3): row $0.00002, priced at $0.02436.

**Limit** = measured × 1.10, as the design requires. Monad charges the gas **limit**, and a revert pays all of it.
MON per transaction = limit × 102 gwei.

| Transaction | gasUsed | Limit (+10%) | MON |
|---|---|---|---|
| `placeBetFor` BTC, first bet on a new column | 160,790 | **176,869** | 0.0180 |
| `placeBetFor` MON, first bet on a new column | 160,846 | **176,930** | 0.0180 |
| `placeBetFor` BTC, column open, first bet in its liability word (8 bands per word) | 142,926 | 157,218 | 0.0160 |
| `placeBetFor` MON, column open, first bet in its liability word | 143,164 | 157,480 | 0.0161 |
| `placeBetFor` BTC, column and liability word already used | 126,063 | 138,669 | 0.0141 |
| `placeBetFor` MON, column and liability word already used | 126,164 | 138,780 | 0.0142 |
| `placeBetFor` BTC, as above, with an access list | 96,470 | 106,117 | 0.0108 |
| `settleColumn` BTC, 69-tick tape, 1 bet | 438,945 | **482,839** | 0.0492 |
| `settleColumn` MON, 69-tick tape, 1 bet | 457,640 | **503,404** | 0.0513 |
| `settleColumn` BTC, 69-tick tape, 3 bets (3 players) | 478,440 | 526,284 | 0.0537 |
| `settleColumn` MON, 69-tick tape, 3 bets (3 players) | 496,088 | 545,696 | 0.0557 |
| `settleColumn` BTC, 69-tick tape, 10 bets (10 players) | 616,677 | 678,344 | 0.0692 |
| `settleColumn` BTC, volatile tape, 1 bet | 566,793 | 623,472 | 0.0636 |
| `settleColumn` MON, volatile tape, 1 bet | 569,218 | 626,139 | 0.0639 |
| `settleColumn` BTC, 1 bet, with an access list | 408,512 | 449,363 | 0.0458 |
| `grant`, including the 16-word bet pre-fill | 426,211 | **468,832** | 0.0478 |
| `withdrawFor` | 148,036 | **162,839** | 0.0166 |
| `depositFor` (permit + Deposit) | 208,248 | **229,072** | 0.0234 |
| **Markets upgrade:** new implementation (CREATE) | 5,353,371 | 5,888,708 | 0.6006 |
| **Markets upgrade:** `upgradeToAndCall(impl, initializeMarkets(…))` | 154,913 | 170,404 | 0.0174 |
| Fresh deploy, all 9 transactions | 8,215,232 | 9,036,755 | 0.92 |

## The row-bound quote (security review M1, 2026-10-10)

The Quote now signs `int64 rowE8` and `_placeBet` checks it against the market's row. Re-measured with 3 `gas.sh` runs
and the fork rehearsal (block 69,653,221): bets are within the run-to-run spread of before (a column's first bet
160,841 at most, was 160,846; warm 126,147, was 126,164; with an access list 96,470, was 96,463), so every bet limit
stands except the access-list one (+8). The implementation is 19,477 gas bigger to deploy. Settle gas is unchanged.

## What markets changed

- **Bets** cost about 1,300–1,600 gas more than before the upgrade. Before, the three bet cases were 159,503,
  141,548 and 124,673, and 95,073 with an access list. The extra gas pays for:
  - one read of the market's slot and one write of it (`openLiab`);
  - the `uint8 asset` in calldata and in the signed hashes;
  - one more indexed topic on `BetPlaced`.
- **No zero-to-non-zero charge.** The market's open liability shares the market's one storage slot with `rowE8`
  (never 0 once listed), so a market's first bet does not pay MIP-8's 17,000-gas zero-to-non-zero charge. The bet
  limit would otherwise have to rise by about 19k.
- **Settle gas is the same per asset.** Settle cost depends on how many bands the tape crosses and on the column's
  parity, not on the asset. Both markets are measured at the same tape amplitude in bands:
  - typical: ±0.4 band per tick;
  - volatile: ±2.5 bands, half of `maxMoveE8`.

  The spread between runs (BTC 1 bet: 401k–439k; MON 1 bet: 392k–458k) comes from where the price sits in its band
  and from column parity. Before markets, the same spread was "±8% with parity" and the 1-bet figure was 435,272.
  Markets add, per settle:
  - one market-slot read and one write (on page 0, which is already warm);
  - one indexed topic per `HexTouched`, `ColumnSettled` and `BetSettled` (375 gas each).
- **The upgrade** costs about 0.62 MON at limit × 102 gwei with `--gas-estimate-multiplier 110`.

## Notes for the services

- **Tape.** "69 ticks" is the full tape: every 100 ms grid tick from 66 ms before `t_lo` to 66 ms after `t_hi`.
  - "Typical" and "volatile" are fixed random walks from the market's price, at the amplitudes above.
  - A one-way trend costs more than a zigzag. Security review, in-call gas for 1 player:
    - 0.5 band per tick: 589k;
    - 1 band: 786k;
    - 2 bands: 1.30M;
    - 3 bands: 1.81M;
    - `maxMoveE8` every tick: 2.17M.
  - The keeper halves its batch when a simulation fails and retries a lone tape settle with a 2.5M cap (keeper.ts),
    so only a tape over ~2.4M can still VOID.
  - The tape move limit is per market: `markets(asset).maxMoveE8`.
- **settleColumn limit:** about `1.1 × (438,000 + 19,750 × players)` for a typical tape, with one bet per player
  (the per-player step is measured; the base covers the highest 1-bet run above). For a volatile tape, add about
  135,000. A transaction that runs out of gas still pays its whole limit. If the tape stays unsettled, the column
  VOIDs after `voidAfterMs`.
- **placeBetFor limit:**
  - If every bet uses one fixed limit, it must be **176,930**, the cost of a bet that opens a column (either market).
  - The relayer can know the cheaper cases from its own state. Both are per `(asset, k)` column:
    - a column that already has a bet: 157,480;
    - a liability word already used, meaning the same group of 8 bands from `bJ0`: 138,780.
- **Access lists:**
  - They cut about 30k from a bet and 20–40k from a settle, using the list anvil's `eth_createAccessList` returned.
  - The design calls for access lists on every service transaction, so re-measure them on testnet
    (`eth_simulateV1`) before fixing the limits.
- **grant** pre-fills the player's 16 bet words. Without that, a player's first 16 bet words would each add 17,000
  gas (zero to non-zero) to a bet. A player who only ever deposited, and was never granted, would need about +17k on
  a bet.
- **Deploy and upgrade:** forge's default `--gas-estimate-multiplier` is 130 and is charged in full. Use
  `--gas-estimate-multiplier 110`.

## Against the design's estimates

- **Bet:** 0.0142 MON warm without an access list, 0.0108 with one, 0.0180 for a column's first bet. The design
  estimated about 0.013.
- **Settle:** 0.045–0.051 MON per column with one bet, more for more players or a volatile tape. The design
  estimated 0.02–0.04.
  - About 220k of it is the hex test (`HexGeo.segHits`, run by `_applyTape`) over 68 segments.
  - About 50k is calldata and the base cost of a 69-tick tape (two `uint64[]` arrays, as the design fixes the signature).
- **Already done:** reading each tape element once, with the I11 checks folded into the hash pass
  (`settleColumn` with 1 bet went from 548k to about 435k).
