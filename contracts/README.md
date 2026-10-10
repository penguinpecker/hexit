# Hexit contracts (Monad)

Foundry project for the pay-per-bet Monad build. The design, trust model and deploy overview are in
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

There are two contracts, each behind its own ERC1967 (UUPS) proxy:
- **`TestUSDC`**: 6-decimal play money with an EIP-2612 permit. The owner and the game may mint it.
- **`HexitGame`**: custody of all tUSDC, player credit, bets, settlement and caps, for several markets at once.

**Markets.** A market is an asset id: SOL 0, BTC 1, ETH 2, MON 3 (ids 0–7 exist). Each market has its own band height
(`rowE8`), tape move limit (`maxMoveE8`), liability cap (`maxLiab`) and an `enabled` flag, all set by the owner.
Columns, liabilities and settlement are keyed by `(asset, k)`. A player has **one credit balance** for every market,
and the daily loss limit and the hex, column and total caps are shared too. Live: **BTC/USD (1) and MON/USD (3)**.
SOL (0) is closed to new bets since the markets upgrade, but its old bets still settle or VOID.

`HexGeo` is an internal library: the hex geometry (column spans, `segHits`, `bandRange`), integers only.

Gas figures and limits are in [GAS.md](GAS.md). ABIs come from `forge build`: `out/HexitGame.sol/HexitGame.json` and
`out/TestUSDC.sol/TestUSDC.json`, under the `abi` key.

## Commands

```
npm ci                 # pinned deps: OZ 5.7.0, upgrades-core 1.46.0, forge-std 1.17.0 (no git submodules)
forge build            # Foundry >= 1.8.5, solc 0.8.37, via_ir, network = "monad"
forge test             # 86 tests incl. vectors, the upgrade from the live bytecode and a 256 x 200 invariant campaign (about 20 s)
npm run validate       # OpenZeppelin upgrade safety of both implementations, storage checked against the archived
                       # deployments/build-info-testnet-20261009 (gitignored; keep it)
./gas.sh               # gas on a local anvil --network monad (never a public network)
./rehearse-upgrade.sh  # the markets upgrade on a local anvil fork of testnet (reads the chain, never sends to it)
```

## Proxy rules (both contracts)

- Both inherit `Initializable, UUPSUpgradeable, Ownable2StepUpgradeable`.
- The constructor calls `_disableInitializers()` and carries `@custom:oz-upgrades-unsafe-allow constructor`.
- All configuration goes through `initialize`.
- `_authorizeUpgrade` is `onlyOwner`.
- Storage ends in a `__gap`: 49 slots in TestUSDC. In HexitGame, slots 0–9 came first, then the markets upgrade
  appended `Market[8] markets` (slots 10–17), so the gap shrank from 40 to 32 and still ends at slot 50.
- `initializeMarkets` is `reinitializer(2) onlyOwner` and runs through `upgradeToAndCall`. A future reinitializer is
  `reinitializer(3+) onlyOwner`; `test/Upgrade.t.sol` shows the pattern.

HexitGame keeps each player's struct (17 slots) and each column's struct (34 slots) at **page-aligned hashed
slots**: `keccak256(abi.encode(key, ns)) & ~127`. Under MIP-8, a player or a column then always sits on exactly one
128-slot page. Nothing else lives there, and the linear layout (slots 0–17 + gap) is all on page 0.
A column's key is `k | asset << 32`, so asset 0 keeps every pre-markets (SOL) column at its old slot.
Each `Market` is one slot that is never zero once listed (`rowE8 > 0`), so updating its `openLiab` never pays MIP-8's
zero-to-non-zero charge.

## Roles

| Role | Where | Can do |
|---|---|---|
| owner (admin) | `Ownable2Step` | `setParams`, `setMarket`, `setPause` set/clear, `grant`, `houseDeposit`/`houseWithdraw`/`sweep`, `upgradeToAndCall` (+ `initializeMarkets` once) |
| guardian | `params.guardian` | `setPause(bits, true)` and `setDisabled(bits, true)` only |
| recorders[3] | `params.recorders` | sign `ColumnTape` (sign only; zero entry = empty slot) |
| quoter | `params.quoter` | sign `Quote` (sign only) |
| relayer | `params.relayer` | the only `placeBetFor` sender; `grant` |
| keeper | nobody special | `settleColumn` / `voidColumn` are permissionless |

Pause bits are `PAUSE_DEPOSIT = 1` (blocks `depositFor`) and `PAUSE_PLAY = 2` (blocks bets). Withdrawals, settlement
and voids are never paused. `disabled` bit i blocks `params.recorders[i]` in `settleColumn` (the kill switch for a
leaked tape key: its columns VOID after `voidAfterMs` unless the owner rotates the key with `setParams`).

## EIP-712

**Domain:** `{ name: "Hexit", version: "1", chainId: 10143, verifyingContract: <HexitGame proxy> }`.
`domainSeparator()` returns it. It is computed per call, so it follows the chain id.

**Type strings (exact).** The markets upgrade added `uint8 asset` to Bet, Quote and ColumnTape, and `int64 rowE8` (the
band height the quote was priced at) to Quote, so their typehashes
(`BET_TYPEHASH`, `QUOTE_TYPEHASH`, `TAPE_TYPEHASH`: `keccak256` of each string, public constants checked by
`test_typehashes_match_readme`) changed. Signatures in the old format are refused (`BadSig` / `NotQuoter` /
`NotRecorder`). The domain is unchanged.
```
Bet(address player,uint8 asset,uint32 k,int32 j,uint64 stake,uint16 minMult,uint64 nonce,uint64 deadline)
Quote(uint8 asset,int64 rowE8,uint32 k,int32 qJ0,uint64 refTsMs,uint64 refPriceE8,uint64 expiresMs,bytes32 multsHash)
ColumnTape(uint8 asset,uint32 k,bytes32 ticksHash)
Withdraw(address player,uint64 amount,uint64 nonce,uint64 deadline)
Deposit(address player,uint64 amount,uint64 nonce,uint64 deadline)
```

**Hashes and encodings:**
- **multsHash** = `keccak256(abi.encodePacked(uint16[64] mults))`. Solidity pads array elements in `encodePacked`,
  so this is 64 big-endian 32-byte words, the same as `abi.encode(uint16[64])`. In viem, both
  `keccak256(encodePacked(['uint16[64]'], [mults]))` and `keccak256(encodeAbiParameters([{type:'uint16[64]'}], [mults]))`
  give it.
  - `mults[i]` is the multiplier ×100 for band `qJ0 + i`.
  - 0–100 means not offered.
  - The calldata `Quote` tuple has **no** `multsHash`: it is `(asset, rowE8, k, qJ0, refTsMs, refPriceE8, expiresMs)`,
    and the contract hashes the `uint16[64]` passed next to it.
- **Quote `rowE8`** must equal `markets(asset).rowE8` when the bet lands (`QuoteStale` otherwise). A quote signed before
  a `setMarket` row change therefore never prices a bet after it (security review M1), so the owner may change a row
  without first closing the market; only bets on quotes from the old row are refused for the ~1.5 s they stay fresh.
- **The calldata `Bet` tuple** is `(player, asset, k, j, stake, minMult, nonce, deadline)`, in the type string's order.
- **ticksHash** = `keccak256(abi.encodePacked(uint64 ts0, uint64 px0, uint64 ts1, uint64 px1, ...))`: scalars
  packed tight, **16 bytes per tick** (ts then price, big-endian). In viem:
  `keccak256(encodePacked(ticks.flatMap(() => ['uint64','uint64']), ticks.flatMap(t => [t.ts, t.px])))`.
  Do not use `encodePacked(['uint64[]'], ...)`, which pads.
- **Units:** `deadline` is unix **seconds** (compared with `block.timestamp`). `refTsMs`, `expiresMs` and tick
  timestamps are unix **milliseconds**. Prices are 1e-8 USD. Amounts and stakes are micro-tUSDC.
- **Nonces:** `Bet`, `Withdraw` and `Deposit` share one unordered 32-wide window per player (`nonceBase`,
  `nonceMask` in `playerOf`).
  - Any unused nonce in `[nonceBase, nonceBase + 32)` is valid. The window slides past a run of used nonces.
  - A nonce whose signature expired unsent can be signed again.
- **Signatures:** 65-byte `r‖s‖v`. Malformed or high-s signatures revert `BadSig`.
- **Permit for `depositFor`:** tUSDC's EIP-2612 domain is `{ name: "Hexit Test USDC", version: "1", chainId,
  verifyingContract: <TestUSDC proxy> }`, with `spender = game`, `value = amount` and `deadline` = the Deposit's
  `deadline`.

viem `types` object:
```js
const types = {
  Bet: [{name:'player',type:'address'},{name:'asset',type:'uint8'},{name:'k',type:'uint32'},{name:'j',type:'int32'},
        {name:'stake',type:'uint64'},{name:'minMult',type:'uint16'},{name:'nonce',type:'uint64'},{name:'deadline',type:'uint64'}],
  Quote: [{name:'asset',type:'uint8'},{name:'rowE8',type:'int64'},{name:'k',type:'uint32'},{name:'qJ0',type:'int32'},
          {name:'refTsMs',type:'uint64'},{name:'refPriceE8',type:'uint64'},{name:'expiresMs',type:'uint64'},{name:'multsHash',type:'bytes32'}],
  ColumnTape: [{name:'asset',type:'uint8'},{name:'k',type:'uint32'},{name:'ticksHash',type:'bytes32'}],
  Withdraw: [{name:'player',type:'address'},{name:'amount',type:'uint64'},{name:'nonce',type:'uint64'},{name:'deadline',type:'uint64'}],
  Deposit: [{name:'player',type:'address'},{name:'amount',type:'uint64'},{name:'nonce',type:'uint64'},{name:'deadline',type:'uint64'}],
}
```

**Test vectors** (viem 2.57.4 `hashTypedData`, asserted in `test_eip712_vectors_match_viem`). Inputs:
- domain chainId 10143, verifyingContract `0x00000000000000000000000000000000000000aa`;
- `asset = 3` (MON) in Quote, Bet and ColumnTape, and `rowE8 = 2000` in Quote;
- `mults[i] = 150 + 10*(i % 32)`;
- ticks `(1790000009100, 12002250000)`, `(1790000009200, 12002350000)`, `(1790000009300, 12002150000)`.

| Item | Inputs | Hash |
|---|---|---|
| multsHash | as above | `0xa4d69d8a1e217af491f513e94e73c7175c058e97d6b2262c193ea798c5dc3f6c` |
| ticksHash | as above | `0xe640a17873080e8f02b1c91295921b89cad701afdf7fec245c91bc05cb40b962` |
| Quote digest | asset 3, rowE8 2000, k 358000002, qJ0 -5, refTsMs 1790000003000, refPriceE8 12002250000, expiresMs 1790000004500 | `0x18924f36958f3ea4139f035437e8c8ca512d9220bbce1c8bfa5afffae2d628e6` |
| Bet digest | player `0x…bb`, asset 3, k 358000002, j -7, stake 1000000, minMult 101, nonce 3, deadline 1790000010 | `0x779f6fb72275e794ea542c432eadc29a97ba02278f4937a9a8e9cbfcb45afa87` |
| ColumnTape digest | asset 3, k 358000002, ticksHash above | `0xa0404638e9aeb3199199acb8d1c0771a54c816a4972386dfe2246c8a9e41def2` |

## HexitGame functions

Notation: `nowMs = block.timestamp · 1000` (whole seconds), `t_lo(k) = 5000k − 834`, `t_hi(k) = 5000k + 5834`.
Checks run in the order listed; the custom error name follows each.

**`placeBetFor(Bet b, bytes sig, Quote q, uint16[64] mults, bytes quoterSig)`** (relayer) and
**`placeBet(Bet b, Quote q, uint16[64] mults, bytes quoterSig)`** (`msg.sender == b.player`):

1. sender is the relayer → `NotRelayer` (placeBetFor only);
2. not `PAUSE_PLAY` → `IsPaused`;
3. player signature over `Bet` → `BadSig` (placeBet: sender ≠ player → `BadSig`);
4. `markets[b.asset].enabled` → `MarketClosed` (an asset id above 7 reverts with `Panic(0x32)`);
5. `block.timestamp ≤ b.deadline` → `Expired`;
6. nonce in the window and unused → `NonceUsed`;
7. `minStake ≤ stake ≤ maxStake` → `StakeOutOfRange`;
8. `quoterSig` recovers `params.quoter` → `NotQuoter` (malformed → `BadSig`);
9. `nowMs − quoteMaxAgeMs ≤ refTsMs ≤ nowMs + 1000` and `expiresMs ≥ nowMs` → `QuoteStale`;
10. `q.asset == b.asset`, `q.k == b.k` and `qJ0 ≤ j < qJ0 + 64` → `NotQuoted`;
11. `q.rowE8 == markets[b.asset].rowE8` → `QuoteStale` (the quote was priced at another band height);
12. `mult = mults[j − qJ0]`: `101 ≤ mult ≤ 10000` (`MAX_MULT`, at most 100x) → `NotOffered`, `mult ≥ minMult` → `BelowMinMult`;
13. lock: `t_lo(k) ≥ max(refTsMs, nowMs) + 5100 + lockMarginMs` → `Locked`;
14. `payout = stake·mult/100 ≤ maxPayout` → `PayoutCap`;
15. the column `(asset, k)`'s first bet sets `bJ0 = floor(refPriceE8 / markets[asset].rowE8) − 128`. Then:
    - `bJ0 ≤ j ≤ bJ0 + 255` → `NotQuoted`;
    - hex liability `≤ maxHexLiab` → `HexCap`;
    - column `≤ maxColLiab` → `ColumnCap`;
    - this market's open payouts `≤ markets[asset].maxLiab` → `AssetCap`;
    - all markets' open payouts `≤ maxMarketLiab` → `MarketCap`;
    - `houseLiab + payout − stake ≤ house` → `HouseCapacity`;
16. `credit ≥ stake` → `InsufficientCredit`;
17. a free slot below `maxOpen` → `TooManyOpen`;
18. after the UTC-day roll, `netLossToday < dailyLossLimit` → `DailyLossHalt`.

The quoter's job: sign `qJ0 = band(refPriceE8) − 32` (64 bands around the price) and the market's current `rowE8`. Any band of a column must stay
within 128 bands of the price at that column's first bet.

**`settleColumn(uint8 asset, uint32 k, uint64[] ts, uint64[] px, bytes recorderSig, address[] players)`** (anyone).
Column `(asset, k)` is checked against `markets[asset]`'s `maxMoveE8` and `rowE8`, and it settles whether or not the
market is enabled.
- If the column is not decided yet:
  1. `ts.length ≥ 2` and `px.length == ts.length` → `BadTape`;
  2. `nowMs ≤ t_hi(k) + voidAfterMs` → `TooLate` (after that, use `voidColumn`);
  3. last tick `≤ nowMs + 1000` → `TickInFuture`;
  4. every tick on the 100 ms grid → `OffGrid`; strictly increasing → `TickNotNewer`;
     `|Δpx|·100 ≤ markets[asset].maxMoveE8·Δts` → `MoveTooLarge`;
  5. `recorderSig` over `ColumnTape{asset, k, ticksHash}` recovers one of `params.recorders` whose `disabled` bit is clear
     → `NotRecorder` (malformed → `BadSig`);
  6. `ts[0] ≤ t_lo(k)` and `ts[last] ≥ t_hi(k)` → `BadTape`;
  7. it then runs the column rule (`_applyTape`) on every consecutive pair, emits `HexTouched` per newly touched band and stores
     `touched`/`gap`.
- The tape the recorder signs: every grid tick from the last at or before `t_lo(k)` through the first at or after
  `t_hi(k)`. A missing stretch over `gapMs` (250 ms) sets `gap`, which VOIDs untouched bands.
- Then it settles each listed player's open bets on `(asset, k)`:
  - **WIN** (1) if the band was touched: credited `payout`;
  - else **VOID** (3) on a gap: credited `stake`;
  - else **LOSS** (2): credited 0.
- Once k is decided, the tape arguments are ignored: later calls (even with empty arrays) only settle more players.
  Players without bets on k, and duplicates, are skipped. No bet can settle twice.

**`voidColumn(uint8 asset, uint32 k, address[] players)`** (anyone):
- If `(asset, k)` is undecided: `nowMs > t_hi(k) + voidAfterMs` → `TooEarly`, then it becomes VOIDED.
- Either way it then settles the listed players by k's decision. VOIDED refunds every stake exactly. On a column
  already settled from a tape, it applies that result instead.
- A tape and a void never both apply: the tape window and the void window do not overlap.

**Money (I1 is checked after every token movement → `TreasuryMismatch`):**
- **`grant(address player)`** (relayer or owner): once per player, ever.
  - Errors: `NotRelayer`, `AlreadyGranted`.
  - Mints 100 tUSDC into the game as the player's credit and pre-fills the player's 16 bet words.
- **`depositFor(address player, uint64 amount, uint64 nonce, uint64 deadline, bytes sig, uint8 v, bytes32 r, bytes32 s)`**
  (anyone):
  - Checks, in order: `IsPaused`, `BadSig`, `Expired`, `NonceUsed`.
  - The permit runs inside try/catch, so a front-run permit is harmless. `transferFrom(player)` then credits the
    player.
- **`withdrawFor(address player, uint64 amount, uint64 nonce, uint64 deadline, bytes sig)`** (anyone) and
  **`withdraw(uint64 amount)`** (the player):
  - Checks: `BadSig`, `Expired`, `NonceUsed`, then `0 < amount ≤ credit` → `InsufficientCredit`.
  - Pays only `player`. Never paused.
- **`houseDeposit(uint64)` / `houseWithdraw(uint64)` / `sweep()`** (owner): withdraw needs
  `house − amount ≥ houseLiab` → `ReserveBreach`. `sweep` books direct transfers into `house`.

**Admin:**
- `setMarket(uint8 asset, MarketConfig c)` (owner) lists, tunes, opens or closes a market and takes effect at once:
  - `c.rowE8 > 0` → `BadParams`;
  - a row change while the market has open bets → `MarketBusy`. Their columns keep the band index the first bet set
    from the old row. Everything else can change at any time. Quotes sign the row, so the ones signed before a row
    change are refused (`QuoteStale`) and the market may stay open through it;
  - `asset > 7` → `Panic(0x32)`;
  - emits `MarketSet`.
- `initializeMarkets(uint8[] assets, MarketConfig[] cfgs)` (owner, once: `reinitializer(2)`):
  - lengths differ → `BadParams`;
  - asset 0 gets the legacy `rowE8`, `params.maxMoveE8` and `params.maxMarketLiab`, `enabled = false`, and
    `openLiab = openLiability` (every bet open at the upgrade is a SOL bet);
  - then each `(assets[i], cfgs[i])` goes through `setMarket`'s checks.
- `setParams(Params)` (owner) checks `maxOpen ≤ 32`, `1 ≤ minStake ≤ maxStake`, `maxPayout ≤ maxHexLiab` and
  `gapMs ≥ 100` → `BadParams`, and takes effect at once.
- `setPause(uint8 bits, bool on)`: the owner may set or clear; the guardian may only set → `NotGuardian`.
- `setDisabled(uint8 bits, bool on)`: the same rule; bit i (0–2) blocks `params.recorders[i]`. Emits `Disabled`.
- `initialize(owner, usdc, rowE8, Params)` also rejects `usdc == 0` or `rowE8 ≤ 0` (`BadParams`).
- OZ errors: `OwnableUnauthorizedAccount`, `InvalidInitialization`, `UUPSUnauthorizedCallContext`.
- New with markets: `MarketClosed`, `AssetCap`, `MarketBusy`.
- TestUSDC adds `NotMinter`.

**`Params` tuple order** (packed into 7 slots):
`(address[3] recorders, address quoter, uint64 maxPayout, uint32 minStake, address guardian, uint64 maxColLiab,
uint32 maxStake, address relayer, uint64 maxMarketLiab, uint32 maxHexLiab, uint64 dailyLossLimit, uint64 maxMoveE8,
uint32 voidAfterMs, uint16 gapMs, uint16 quoteMaxAgeMs, uint16 lockMarginMs, uint8 maxOpen)`.
- `maxMarketLiab` caps all markets together; each market also has its own `maxLiab`.
- `maxMoveE8` only seeded asset 0 in `initializeMarkets`. Tapes use `markets[asset].maxMoveE8`.

Testnet values (set by the deploy script):

| Param | Value |
|---|---|
| minStake / maxStake | 100,000 / 50,000,000 |
| maxPayout | 2,500,000,000 |
| maxHexLiab | 4,000,000,000 |
| maxColLiab | 20,000,000,000 |
| maxMarketLiab | 100,000,000,000 |
| dailyLossLimit | 1,000,000,000,000 |
| maxMoveE8 | 25,000,000 (asset 0's seed only) |
| voidAfterMs | 120,000 |
| gapMs | 250 |
| quoteMaxAgeMs | 1,500 |
| lockMarginMs | 1,000 |
| maxOpen | 32 |

`rowE8` (the public variable) is 5,000,000: asset 0's row from initialize. The live rows are in `markets`. The house
starts with 10,000,000 tUSDC.

**Markets** (`script/Markets.sol`; both the upgrade and a fresh deploy use this list). The values are placeholders
until the pricing research sets them, and the owner retunes them with `setMarket`. Live since 2026-10-10, against spot
that day of BTC $82,385 and MON $0.02436. The tape move limits are $125 and $0.00015 per 100 ms (25 and 15 bands).

| id | Market | rowE8 (band) | maxMoveE8 | maxLiab | enabled |
|---|---|---|---|---|---|
| 0 | SOL/USD | 5,000,000 ($0.05) | 25,000,000 | 100,000,000,000 | no (closed by the upgrade) |
| 1 | BTC/USD | 500,000,000 ($5, 0.006 %) | 12,500,000,000 | 50,000,000,000 | yes |
| 3 | MON/USD | 1,000 ($0.00001, 0.04 %) | 15,000 | 50,000,000,000 | yes |

- **`MarketConfig` tuple** (the `setMarket` / `initializeMarkets` input): `(int64 rowE8, uint56 maxMoveE8,
  uint64 maxLiab, bool enabled)`.
- **`markets(uint256 asset)` getter**: `(int64 rowE8, uint56 maxMoveE8, bool enabled, uint64 maxLiab,
  uint64 openLiab)`. `openLiab` is the Σ payout of the market's open bets.
- Services should read rows and limits from `markets(asset)` on chain, because `setMarket` changes them without
  touching the deployment record.

## Events

```
BetPlaced(address indexed player, uint8 indexed asset, uint32 indexed k, int32 j, uint64 stake, uint16 mult, uint64 nonce, uint8 slot)
BetSettled(address indexed player, uint8 indexed asset, uint32 indexed k, int32 j, uint64 stake, uint16 mult, uint8 slot, uint8 outcome, uint64 credited)
HexTouched(uint8 indexed asset, uint32 indexed k, int32 j, uint64 tsMs)   // once per band, at settlement; tsMs = end of the touching segment
ColumnSettled(uint8 indexed asset, uint32 indexed k, int32 bJ0, bool gap, uint256 touched)   // touched bit i = band bJ0 + i
ColumnVoided(uint8 indexed asset, uint32 indexed k)
MarketSet(uint8 indexed asset, int64 rowE8, uint56 maxMoveE8, uint64 maxLiab, bool enabled)
Granted(address indexed player, uint64 amount)
Deposited(address indexed player, uint64 amount)
Withdrawn(address indexed player, uint64 amount)
ParamsSet(address indexed by)
Paused(address indexed by, uint8 bits)                        // bits = the pause bits after the change
Disabled(address indexed by, uint8 bits)                      // bits = the recorder kill bits after the change
HouseDeposit(uint64 amount)   HouseWithdraw(uint64 amount)   Swept(uint64 amount)
```

`slot` (0–31) is the player's open-bet slot. `BetSettled` matches its `BetPlaced` by `(player, slot)`.
`outcome` is 1 WIN, 2 LOSS or 3 VOID.

The five bet and column events kept their names but gained `uint8 indexed asset`, so their topic0 changed at the
markets upgrade. An indexer decodes logs before the upgrade block with the old signatures (asset 0) and logs after it
with these.

## Views

- **`playerOf(address)`** returns `(uint64 credit, uint64 openStake, uint48 nonceBase, uint32 nonceMask,
  uint32 openMask, bool granted, uint256[16] bets)`. Bet slot `i` is the 128-bit half `i & 1` of `bets[i >> 1]`:
  `k u32 | j i32 << 32 | stake u32 << 64 | mult u16 << 96 | asset u8 << 112`. Bets placed before the markets upgrade
  have asset bits 0 (SOL). A slot is open only if its `openMask` bit is set.
- **`columnOf(uint8 asset, uint32 k)`** returns `(int32 bJ0, uint8 state, bool gap, uint64 totalLiab, uint256 touched)`. State is
  0 untouched, 1 open, 2 settled, 3 voided.
- **`markets(uint256 asset)`**: see "Markets" above.
- **Other getters:** `getParams()`, `domainSeparator()`, `house`, `houseLiab`, `totalCredit`, `totalOpen`,
  `openLiability`, `netLossToday`, `day`, `paused`, `disabled`, `rowE8`, `usdc`, `owner`, `pendingOwner`, the `*_TYPEHASH`
  constants, `GRANT` (100e6), `MAX_MULT` (10000), `PAUSE_DEPOSIT`, `PAUSE_PLAY`.
- **Treasury identity:** `tUSDC.balanceOf(game) ≥ house + totalCredit + totalOpen`.

## Deploy

`script/Deploy.s.sol` (a fresh system; the live one moves with "The markets upgrade" below) runs 9 transactions from
the admin, one at a time with `--slow`:
1. the TestUSDC implementation, then `ERC1967Proxy(impl, initialize(admin))`;
2. the HexitGame implementation, then `ERC1967Proxy(impl, initialize(admin, usdc, 5_000_000, params))`, then
   `initializeMarkets(hexitMarkets())`;
3. `setMinter(game, true)`;
4. `mint(admin, 10M tUSDC)`;
5. `approve`;
6. `houseDeposit`.

There is no column prewarm.

**Environment variables:**
- **Role addresses:** `HEXIT_ADMIN`, `HEXIT_GUARDIAN`, `HEXIT_RECORDER`, `HEXIT_QUOTER`, `HEXIT_KEEPER`,
  `HEXIT_RELAYER`.
- **Signer:**
  - With `HEXIT_KEY_ADMIN` set, the script derives the address and aborts unless it equals `HEXIT_ADMIN`.
  - Without it, the forge sender must be `HEXIT_ADMIN`.
- **`HEXIT_DEPLOY_OUT`:** default `deployments/<chainId>.json`.
- **`HEXIT_LABEL`:** copies `out/build-info` to `deployments/build-info-<label>` (about 25 MB), the reference for
  future upgrade validation.
- **`HEXIT_RPC_HTTP` / `HEXIT_RPC_WS`:** recorded only.

Testnet (the admin runs this). The admin key goes from the key file into forge's environment only; it is never
printed:
```
cd contracts && npm ci
export HEXIT_ADMIN=0x80A13649181682Ded1b080822f30c2A7B977BD53 HEXIT_GUARDIAN=0x815D4107D06550fA4dED308c64840e7Ad89DF151 \
  HEXIT_RECORDER=0x204E9C68b9E6da4A0506886892Dd36A0da08738D HEXIT_QUOTER=0x78774441a9514F68e042be1fe7AB53cBf380C3bd \
  HEXIT_KEEPER=0x6628466DA25dc84516c52a79F3089aCEE4051220 HEXIT_RELAYER=0x20df2Af4E74DC889eC6cEAcb089faD8B5a1d36A6 \
  HEXIT_DEPLOY_OUT=../deployment/monad.json HEXIT_LABEL=testnet-<date>
HEXIT_KEY_ADMIN="$(jq -r '.[0].private_key' ../keys/monad/admin.json)" \
  forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --slow --force --gas-estimate-multiplier 110
```
- The key files are `cast wallet new --json` output from an older cast (an array). Foundry 1.8.5 wraps new output
  in `{data:[…]}`.
- Verify each implementation and each proxy separately on Sourcify (`forge verify-contract … --verifier sourcify`);
  a proxy also needs its constructor arguments (the implementation address and the initialize call).
- Locally, `./gas.sh` runs this same script against `anvil --network monad` with `--unlocked`.

**`deployment/monad.json` shape** (public data only; amounts are decimal strings):
```
{ "chainId": 10143, "rpc": {"http","ws"}, "game", "gameImpl", "usdc", "usdcImpl",
  "roles": {"admin","guardian","recorder","quoter","keeper","relayer"},
  "deployBlock",                         // block at simulation time: a lower bound for indexer backfill
  "params": {"minStake","maxStake","maxPayout","maxHexLiab","maxColLiab","maxMarketLiab","dailyLossLimit",
             "maxMoveE8","grant" (strings), "voidAfterMs","gapMs","quoteMaxAgeMs","lockMarginMs","maxOpen" (numbers)},
  "markets": {"1": {"rowE8","maxMoveE8","maxLiab" (strings), "enabled"}, "3": {...}},   // read from chain at write time
                                         // (the pre-markets "market" key is deleted in the upgrade steps below)
  "broadcast": "contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json",   // transaction hashes
  "buildInfo": "contracts/deployments/build-info-<label>" }
```

## Upgrades

1. Validate the new implementation against the archived build-info: `npm run validate` (it compares storage with
   `deployments/build-info-testnet-20261009`; for a later reference, change the directory in package.json).
2. Deploy the new implementation.
3. The owner calls `upgradeToAndCall(newImpl, data)`.

Contract names never change, so there are no version markers.

### The markets upgrade (BTC + MON)

`script/Upgrade.s.sol` has two entry points:
- **`run()`** (with `--broadcast`) sends two transactions from the admin: it deploys the new implementation, then calls
  `upgradeToAndCall(impl, initializeMarkets(hexitMarkets()))`, and checks forge's simulation (implementation slot, asset
  0's carry-over, each market). It writes nothing: forge runs a script locally before it broadcasts, so a refused or
  failed broadcast must not leave the record naming an implementation that is not live (security review L1).
- **`record()`** (no `--broadcast`) reads the chain itself: the proxy must run a markets build (a pre-markets one has
  no `markets()`, so the call reverts) with asset 0 closed on its old row and every market as listed. Only then does it
  write `gameImpl` and `markets` into `HEXIT_DEPLOY_OUT`.

- **Cost:** from the fork rehearsal on 2026-10-10 (block 69,653,221), with `--gas-estimate-multiplier 110`:

  | Transaction | gasUsed | Limit | MON at 102 gwei |
  |---|---|---|---|
  | new implementation (CREATE) | 5,353,371 | 5,888,708 | 0.601 |
  | `upgradeToAndCall` | 154,913 | 170,404 | 0.017 |

  Monad charges the limit. The RPC also wants the sender's balance to cover limit × maxFeePerGas when it accepts a
  transaction. forge sets maxFee = 2 × base fee + tip (checked on a local anvil), about 202 gwei here, which needs
  ≈ 1.2 MON for the CREATE. So either hold **≥ 1.3 MON** in the admin, or pass
  `--with-gas-price 110gwei --priority-gas-price 2gwei` and hold ≥ 0.7 MON (0.65 MON + 0.02 MON).
- **Order with the services.** The old ABI's selectors stop existing at the upgrade. Every old-format relayer or
  keeper call then reverts and still pays its gas limit.
  1. Stop the relayer and keeper first (or set `PAUSE_PLAY`, and let the keeper finish the open SOL columns).
  2. Upgrade, then `record()`.
  3. Deploy the services that speak the new ABI and type strings.
- **SOL bets still open at the upgrade.** The upgrade prints the open liability it carried into asset 0. Each such
  bet closes in one of three ways:
  - on an already decided column: `settleColumn(0, k, [], [], "", players)`;
  - by a new-format tape `ColumnTape{asset: 0, k, ticksHash}`, within `voidAfterMs`;
  - otherwise by `voidColumn(0, k, players)`, which anyone can call 120 s after `t_hi(k)` and which refunds every
    stake. The new keeper does this by itself (55–67k gas per void, simulated under a cap of 80k + 30k per bet).
  On 2026-10-10 at block 69,653,471, `openLiability` was 99,950,000 and `totalOpen` 15,000,000: open SOL bets exist,
  and their columns are long past `voidAfterMs`, so the new keeper voids them right after it starts.
- **Rehearse first:** run `./rehearse-upgrade.sh` against the then-current chain state. It forks testnet into a local
  anvil, runs `run()` as the impersonated admin, checks that the pre-upgrade views are unchanged, runs `record()`, then
  grants, bets and settles on BTC and MON with `script/GasBench.s.sol`.
- **Testnet** (the admin runs this):
```
cd contracts && npm ci && npm run validate && ./rehearse-upgrade.sh
export HEXIT_GAME=0xe1341560B697EC40c9fa2e1e6EF270bF6b59fE39 HEXIT_ADMIN=0x80A13649181682Ded1b080822f30c2A7B977BD53 \
  HEXIT_DEPLOY_OUT=../deployment/monad.json
HEXIT_KEY_ADMIN="$(jq -r '.[0].private_key' ../keys/monad/admin.json)" \
  forge script script/Upgrade.s.sol --rpc-url monad_testnet --broadcast --slow --gas-estimate-multiplier 110
forge script script/Upgrade.s.sol --sig 'record()' --rpc-url monad_testnet      # no --broadcast, no key
jq 'del(.market)' ../deployment/monad.json > /tmp/monad.json && mv /tmp/monad.json ../deployment/monad.json
cast impl $HEXIT_GAME --rpc-url monad_testnet                                    # = the record's gameImpl
```
  Then verify the new implementation on Sourcify, like the others (see "Deploy"). Archive its `out/build-info` as the
  next reference: copy it to `deployments/build-info-<label>`, as `HEXIT_LABEL` does in Deploy.s.sol.

## Changes from the prototype design

- **Pay-per-bet:**
  - Removed: `recordTick`, the on-chain tape (`Ticks`), `initMarket`/`prewarm`/`setMarketParams`, the 64-column
    ring, `TapeStale`/`QuoteRefStale`/drift, `ColumnBusy`/`ColumnTooFar`, `settle(address[])` and the quoter bit of
    `setDisabled` (`PAUSE_PLAY` stops every bet). The `asset` fields came back with the markets upgrade
    (`setMarket` / `initializeMarkets` instead of `initMarket`). The quote drift bound (I12) is enforced by
    the relayer API against the live index (services/game/src/api.ts); the direct `placeBet` path does not have it.
  - Columns live in a mapping by k, so a slow keeper never blocks a later column.
- **Types:** `Bet` and `Quote` are as in "EIP-712" above. `Deposit` is new and shares the nonce window. Direct `deposit` is
  gone: use `depositFor`.
- **Errors renamed:**
  - `IsPaused` (the event is named `Paused`);
  - `NotRelayer` (was `NotFaucet`);
  - `BadParams` (was `CapTooHigh`).
- **New errors:** `BadTape`, `TickNotNewer`, `TooLate`, `TooEarly`.
- **`params.faucet` is now `params.relayer`.** The relayer is also the only `placeBetFor` sender.
- **`HexGeo`** and the tape rule are gated by all 2,413 segment vectors and all 360 settle outcomes in
  `tests/vectors/hex_segments.json` (`test/Vectors.t.sol`). `_applyTape` has no branch for a segment that does not
  start at the chain's end, because one contiguous tape cannot produce one.
