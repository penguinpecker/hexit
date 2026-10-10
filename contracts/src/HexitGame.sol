// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {HexGeo} from "./HexGeo.sol";

interface IMintable { function mint(address to, uint256 amount) external; }

/// Hexit on Monad, pay-per-bet (docs/monad/DECISIONS.md). Holds all test USDC; each player has one credit balance,
/// shared by every market. A market is an asset id (SOL 0, BTC 1, ETH 2, MON 3) with its own band height, tape move
/// limit and liability cap; columns, liabilities and settlement are per (asset, k).
/// Bets are EIP-712 signed by the player and carry a quoter-signed Quote. No price tape lives on chain: once a column's
/// span has passed, the keeper submits the recorder-signed tape for that column and settleColumn runs SPEC §6.3 on it.
/// Missing data is never a house win: no valid tape within voidAfterMs lets anyone VOID (refund) the column.
contract HexitGame is Initializable, UUPSUpgradeable, Ownable2StepUpgradeable {
    // ------------------------------------------------------------------ constants
    uint8 public constant PAUSE_DEPOSIT = 1;
    uint8 public constant PAUSE_PLAY = 2;
    uint16 public constant MAX_MULT = 10000;   // SPEC §3: offered multipliers are 101..=10000 (x100)
    uint64 public constant GRANT = 100e6;
    uint8 internal constant OPEN = 1;
    uint8 internal constant SETTLED = 2;
    uint8 internal constant VOIDED = 3;
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("Hexit");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    bytes32 public constant BET_TYPEHASH = keccak256("Bet(address player,uint8 asset,uint32 k,int32 j,uint64 stake,uint16 minMult,uint64 nonce,uint64 deadline)");
    bytes32 public constant QUOTE_TYPEHASH = keccak256("Quote(uint8 asset,int64 rowE8,uint32 k,int32 qJ0,uint64 refTsMs,uint64 refPriceE8,uint64 expiresMs,bytes32 multsHash)");
    bytes32 public constant TAPE_TYPEHASH = keccak256("ColumnTape(uint8 asset,uint32 k,bytes32 ticksHash)");
    bytes32 public constant WITHDRAW_TYPEHASH = keccak256("Withdraw(address player,uint64 amount,uint64 nonce,uint64 deadline)");
    bytes32 public constant DEPOSIT_TYPEHASH = keccak256("Deposit(address player,uint64 amount,uint64 nonce,uint64 deadline)");
    bytes32 internal constant PLAYERS = keccak256("hexit.players");
    bytes32 internal constant COLUMNS = keccak256("hexit.columns");
    uint256 internal constant BET_COLUMN = 0xFF << 112 | 0xFFFFFFFF;  // the bet-record bits that name its column (asset, k)

    // ------------------------------------------------------------------ types
    /// Field order packs into 7 slots.
    struct Params {
        address[3] recorders;      // tape signers; zero = empty slot
        address quoter;            // quote signer
        uint64 maxPayout;          // per bet, stake * mult / 100; <= maxHexLiab
        uint32 minStake;
        address guardian;          // may only set pause bits
        uint64 maxColLiab;         // Σ payout per column
        uint32 maxStake;
        address relayer;           // the only placeBetFor sender; also grant()
        uint64 maxMarketLiab;      // Σ payout of every open bet, all markets together
        uint32 maxHexLiab;         // Σ payout per (k, j)
        uint64 dailyLossLimit;     // house net loss per UTC day before bets halt (wins still pay)
        uint64 maxMoveE8;          // only seeds markets[0] in initializeMarkets; tapes use markets[asset].maxMoveE8
        uint32 voidAfterMs;        // after t_hi(k) + this, no tape is accepted and anyone may VOID column k
        uint16 gapMs;              // tape: a segment longer than this = gap (untouched bands VOID)
        uint16 quoteMaxAgeMs;      // quote.refTsMs may be this old against block time
        uint16 lockMarginMs;       // added to the 5.1 s lock
        uint8 maxOpen;             // open bets per player, <= 32
    }

    struct Bet { address player; uint8 asset; uint32 k; int32 j; uint64 stake; uint16 minMult; uint64 nonce; uint64 deadline; }
    /// The signed EIP-712 Quote also carries multsHash = keccak256(abi.encodePacked(uint16[64] mults)); the contract
    /// recomputes it from the mults passed next to this struct. rowE8 is the band height the quote was priced at: a
    /// quote from before a setMarket row change cannot price a bet after it (security review M1).
    struct Quote { uint8 asset; int64 rowE8; uint32 k; int32 qJ0; uint64 refTsMs; uint64 refPriceE8; uint64 expiresMs; }

    /// What the owner sets for a market (setMarket, initializeMarkets).
    struct MarketConfig {
        int64 rowE8;               // band height; changes only while the market has no open bets
        uint56 maxMoveE8;          // tape: largest |Δprice| per 100 ms
        uint64 maxLiab;            // Σ payout of this market's open bets
        bool enabled;              // takes new bets (settlement and voids never depend on it)
    }

    /// One slot per market. rowE8 > 0 once listed, so the slot is never zero and openLiab updates never pay MIP-8's
    /// zero-to-non-zero charge.
    struct Market { int64 rowE8; uint56 maxMoveE8; bool enabled; uint64 maxLiab; uint64 openLiab; }

    struct Column {
        int32 bJ0;                 // band of touched bit 0, set by the column's first bet (refPrice band - 128)
        uint8 state;               // 0 untouched, 1 OPEN, 2 SETTLED, 3 VOIDED
        bool gap;
        uint64 totalLiab;
        uint256 touched;           // bit (j - bJ0)
        uint256[32] liab;          // 256 bands x u32 payout liability, 8 per word
    }

    struct Player {
        uint64 credit;
        uint64 openStake;
        uint48 nonceBase;
        uint32 nonceMask;          // bit i = nonce nonceBase + i used
        uint32 openMask;           // bit i = bets slot i open
        bool granted;
        uint256[16] bets;          // 32 x 128 bits: k u32 | j i32 << 32 | stake u32 << 64 | mult u16 << 96 | asset u8 << 112
    }

    // ------------------------------------------------------------------ storage (slots 0..17, all on MIP-8 page 0)
    Params internal params;        // slots 0..6
    address public usdc;           // slot 7
    uint8 public paused;
    int64 public rowE8;            //   asset 0's band height from initialize (seeds markets[0]); markets[a].rowE8 is live
    uint64 public house;           // slot 8: bankroll + realised house P&L
    uint64 public houseLiab;       //   Σ (payout - stake) over open bets; <= house (I-solv)
    uint64 public totalCredit;     //   Σ player credit
    uint64 public totalOpen;       //   Σ open stakes
    uint64 public openLiability;   // slot 9: Σ payout over open bets (market cap)
    int64 public netLossToday;     //   wins +, losses -
    uint32 public day;
    uint8 public disabled;         //   bit i blocks params.recorders[i] (guardian kill switch for a leaked tape key)
    Market[8] public markets;      // slots 10..17, by asset id (appended by the markets upgrade; taken from the gap)
    uint256[32] private __gap;
    // Players and columns live at page-aligned hashed slots (_player, _column), outside this linear layout.

    // ------------------------------------------------------------------ errors
    error BadParams(); error NotGuardian(); error NotRelayer(); error IsPaused(); error AlreadyGranted();
    error BadSig(); error Expired(); error NonceUsed(); error StakeOutOfRange();
    error NotQuoter(); error QuoteStale(); error NotQuoted(); error NotOffered(); error BelowMinMult(); error Locked();
    error PayoutCap(); error HexCap(); error ColumnCap(); error MarketCap(); error HouseCapacity();
    error InsufficientCredit(); error TooManyOpen(); error DailyLossHalt(); error ReserveBreach(); error TreasuryMismatch();
    error NotRecorder(); error BadTape(); error OffGrid(); error TickNotNewer(); error MoveTooLarge(); error TickInFuture();
    error TooLate(); error TooEarly(); error MarketClosed(); error AssetCap(); error MarketBusy();

    // ------------------------------------------------------------------ events
    event ParamsSet(address indexed by);
    event Paused(address indexed by, uint8 bits);
    event Disabled(address indexed by, uint8 bits);
    event Granted(address indexed player, uint64 amount);
    event Deposited(address indexed player, uint64 amount);
    event Withdrawn(address indexed player, uint64 amount);
    event HouseDeposit(uint64 amount);
    event HouseWithdraw(uint64 amount);
    event Swept(uint64 amount);
    event MarketSet(uint8 indexed asset, int64 rowE8, uint56 maxMoveE8, uint64 maxLiab, bool enabled);
    event BetPlaced(address indexed player, uint8 indexed asset, uint32 indexed k, int32 j, uint64 stake, uint16 mult, uint64 nonce, uint8 slot);
    /// outcome 1 WIN (credited = payout), 2 LOSS (0), 3 VOID (stake)
    event BetSettled(address indexed player, uint8 indexed asset, uint32 indexed k, int32 j, uint64 stake, uint16 mult, uint8 slot, uint8 outcome, uint64 credited);
    event HexTouched(uint8 indexed asset, uint32 indexed k, int32 j, uint64 tsMs);
    event ColumnSettled(uint8 indexed asset, uint32 indexed k, int32 bJ0, bool gap, uint256 touched);
    event ColumnVoided(uint8 indexed asset, uint32 indexed k);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address owner_, address usdc_, int64 rowE8_, Params calldata p) external initializer {
        if (usdc_ == address(0) || rowE8_ <= 0) revert BadParams();
        __Ownable_init(owner_);
        usdc = usdc_;
        rowE8 = rowE8_;
        day = uint32(block.timestamp / 86400);
        _setParams(p);
    }

    /// The markets upgrade (reinitializer 2), run once by the owner through upgradeToAndCall; a fresh deploy calls it
    /// right after initialize. Asset 0 (SOL) keeps the pre-upgrade row, move limit and cap, takes over every open bet's
    /// liability (all of them are SOL bets) and closes to new bets; its open bets still settle (settleColumn with
    /// asset 0) or VOID (voidColumn). Then each listed market is set. A future reinitializer is (3+) and onlyOwner.
    function initializeMarkets(uint8[] calldata assets, MarketConfig[] calldata cfgs) external reinitializer(2) onlyOwner {
        if (assets.length != cfgs.length) revert BadParams();
        _setMarket(0, MarketConfig(rowE8, uint56(params.maxMoveE8), params.maxMarketLiab, false));
        markets[0].openLiab = openLiability;
        for (uint256 i; i < assets.length; ++i) _setMarket(assets[i], cfgs[i]);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ------------------------------------------------------------------ admin
    function _setParams(Params calldata p) internal {
        if (p.maxOpen > 32 || p.minStake == 0 || p.minStake > p.maxStake || p.maxPayout > p.maxHexLiab || p.gapMs < 100) revert BadParams();
        params = p;
        emit ParamsSet(msg.sender);
    }

    /// Takes effect immediately; this is also how keys rotate.
    function setParams(Params calldata p) external onlyOwner { _setParams(p); }

    /// Lists, tunes, opens or closes a market (asset < 8). Takes effect immediately.
    function setMarket(uint8 asset, MarketConfig calldata c) external onlyOwner { _setMarket(asset, c); }

    function _setMarket(uint8 asset, MarketConfig memory c) internal {
        Market storage m = markets[asset];
        if (c.rowE8 <= 0) revert BadParams();
        // an open column keeps the band index its first bet set from the old row
        if (c.rowE8 != m.rowE8 && m.openLiab != 0) revert MarketBusy();
        (m.rowE8, m.maxMoveE8, m.maxLiab, m.enabled) = (c.rowE8, c.maxMoveE8, c.maxLiab, c.enabled);
        emit MarketSet(asset, c.rowE8, c.maxMoveE8, c.maxLiab, c.enabled);
    }

    function setPause(uint8 bits, bool on) external {
        if (msg.sender != owner() && !(on && msg.sender == params.guardian)) revert NotGuardian(); // GUARD:I3
        paused = on ? paused | bits : paused & ~bits;
        emit Paused(msg.sender, paused);
    }

    /// Recorder kill switch: bit i blocks params.recorders[i] in settleColumn (its columns then VOID after voidAfterMs
    /// unless the owner rotates the key with setParams). The guardian may only set bits; the owner may set or clear.
    function setDisabled(uint8 bits, bool on) external {
        if (msg.sender != owner() && !(on && msg.sender == params.guardian)) revert NotGuardian(); // GUARD:I3
        disabled = on ? disabled | bits : disabled & ~bits;
        emit Disabled(msg.sender, disabled);
    }

    // ------------------------------------------------------------------ money (I1 after every token movement)
    function _checkTreasury() internal view {
        if (IERC20(usdc).balanceOf(address(this)) < uint256(house) + totalCredit + totalOpen) revert TreasuryMismatch(); // GUARD:I1
    }

    /// Once per player, ever: mints 100 tUSDC into the game as the player's credit. Relayer (faucet) or owner.
    function grant(address player) external {
        if (msg.sender != params.relayer && msg.sender != owner()) revert NotRelayer();
        Player storage pl = _player(player);
        if (pl.granted) revert AlreadyGranted();
        pl.granted = true;
        pl.credit += GRANT;
        totalCredit += GRANT;
        // MIP-8: pre-fill the bet words so no bet ever pays the 17,000-gas zero-to-non-zero charge
        for (uint256 i; i < 16; ++i) if (pl.bets[i] == 0) pl.bets[i] = 1;
        IMintable(usdc).mint(address(this), GRANT);
        _checkTreasury();
        emit Granted(player, GRANT);
    }

    /// Gasless deposit: an EIP-712 Deposit signed by the player plus a tUSDC EIP-2612 permit (value = amount,
    /// deadline = the same deadline, spender = this game). Anyone may submit it; the credit always goes to the player.
    function depositFor(address player, uint64 amount, uint64 nonce, uint64 deadline, bytes calldata sig, uint8 v, bytes32 r, bytes32 s) external {
        if (paused & PAUSE_DEPOSIT != 0) revert IsPaused();
        _verify(keccak256(abi.encode(DEPOSIT_TYPEHASH, player, amount, nonce, deadline)), sig, player); // GUARD:SIG
        if (block.timestamp > deadline) revert Expired();
        Player storage pl = _player(player);
        _useNonce(pl, nonce);
        // a front-runner may have used the permit already; the allowance it set is what counts
        try IERC20Permit(usdc).permit(player, address(this), amount, deadline, v, r, s) {} catch {}
        IERC20(usdc).transferFrom(player, address(this), amount);
        pl.credit += amount;
        totalCredit += amount;
        _checkTreasury();
        emit Deposited(player, amount);
    }

    /// Never paused (I3). Pays only the player's own address (I2).
    function withdraw(uint64 amount) external { _withdraw(msg.sender, _player(msg.sender), amount); }

    function withdrawFor(address player, uint64 amount, uint64 nonce, uint64 deadline, bytes calldata sig) external {
        _verify(keccak256(abi.encode(WITHDRAW_TYPEHASH, player, amount, nonce, deadline)), sig, player); // GUARD:SIG
        if (block.timestamp > deadline) revert Expired();
        Player storage pl = _player(player);
        _useNonce(pl, nonce);
        _withdraw(player, pl, amount);
    }

    function _withdraw(address player, Player storage pl, uint64 amount) internal {
        if (amount == 0 || amount > pl.credit) revert InsufficientCredit();
        pl.credit -= amount;
        totalCredit -= amount;
        IERC20(usdc).transfer(player, amount); // GUARD:I2
        _checkTreasury();
        emit Withdrawn(player, amount);
    }

    function houseDeposit(uint64 amount) external onlyOwner {
        IERC20(usdc).transferFrom(msg.sender, address(this), amount);
        house += amount;
        _checkTreasury();
        emit HouseDeposit(amount);
    }

    function houseWithdraw(uint64 amount) external onlyOwner {
        if (amount > house || house - amount < houseLiab) revert ReserveBreach(); // GUARD:ISOLV
        house -= amount;
        IERC20(usdc).transfer(msg.sender, amount); // GUARD:I2
        _checkTreasury();
        emit HouseWithdraw(amount);
    }

    /// Books tUSDC sent to the game directly (a donation) into house.
    function sweep() external onlyOwner {
        uint256 booked = uint256(house) + totalCredit + totalOpen;
        uint256 bal = IERC20(usdc).balanceOf(address(this));
        uint64 extra = bal > booked ? uint64(bal - booked) : 0;
        house += extra;
        emit Swept(extra);
    }

    // ------------------------------------------------------------------ bets (SPEC §4 place_bet, I5, I7, I12)
    /// Relayer only, so nobody can front-run a relayed bet and make the relayer pay for a NonceUsed revert.
    function placeBetFor(Bet calldata b, bytes calldata sig, Quote calldata q, uint16[64] calldata mults, bytes calldata quoterSig) external {
        if (msg.sender != params.relayer) revert NotRelayer();
        if (paused & PAUSE_PLAY != 0) revert IsPaused();
        _verify(keccak256(abi.encode(BET_TYPEHASH, b.player, b.asset, b.k, b.j, b.stake, b.minMult, b.nonce, b.deadline)), sig, b.player); // GUARD:SIG
        _placeBet(b, q, mults, quoterSig);
    }

    /// Direct bet by a player who holds MON.
    function placeBet(Bet calldata b, Quote calldata q, uint16[64] calldata mults, bytes calldata quoterSig) external {
        if (paused & PAUSE_PLAY != 0) revert IsPaused();
        if (msg.sender != b.player) revert BadSig(); // GUARD:SIG
        _placeBet(b, q, mults, quoterSig);
    }

    function _placeBet(Bet calldata b, Quote calldata q, uint16[64] calldata mults, bytes calldata quoterSig) internal {
        Params storage p = params;
        Market memory m = markets[b.asset];
        if (!m.enabled) revert MarketClosed();
        if (block.timestamp > b.deadline) revert Expired();
        Player storage pl = _player(b.player);
        _useNonce(pl, b.nonce);
        if (b.stake < p.minStake || b.stake > p.maxStake) revert StakeOutOfRange();
        // quote: quoter-signed, fresh against block time (whole seconds, so up to +1 s ahead is allowed)
        bytes32 qh = keccak256(abi.encode(QUOTE_TYPEHASH, q.asset, q.rowE8, q.k, q.qJ0, q.refTsMs, q.refPriceE8, q.expiresMs, keccak256(abi.encodePacked(mults))));
        if (_recover(qh, quoterSig) != p.quoter) revert NotQuoter(); // GUARD:I12
        uint256 nowMs = block.timestamp * 1000;
        if (uint256(q.refTsMs) + p.quoteMaxAgeMs < nowMs || q.refTsMs > nowMs + 1000 || q.expiresMs < nowMs) revert QuoteStale(); // GUARD:I12
        if (q.asset != b.asset || q.k != b.k || b.j < q.qJ0 || int256(b.j) >= int256(q.qJ0) + 64) revert NotQuoted();
        if (q.rowE8 != m.rowE8) revert QuoteStale(); // GUARD:I12 priced at another band height (a row change since)
        uint16 mult = mults[uint256(int256(b.j) - q.qJ0)];
        if (mult < 101 || mult > MAX_MULT) revert NotOffered(); // GUARD:I12
        if (mult < b.minMult) revert BelowMinMult();
        // lock: the bet lands at least 5.1 s + margin before its hex span starts
        uint256 ref = q.refTsMs > nowMs ? q.refTsMs : nowMs;
        if (HexGeo.tLo(b.k) < int256(ref + 5100 + p.lockMarginMs)) revert Locked(); // GUARD:I12
        uint64 payout = uint64(uint256(b.stake) * mult / 100);
        if (payout > p.maxPayout) revert PayoutCap(); // GUARD:I7
        _book(b, q.refPriceE8, payout, m);
        if (pl.credit < b.stake) revert InsufficientCredit();
        uint32 open = pl.openMask;
        uint256 slot;
        while ((open >> slot) & 1 == 1) ++slot;
        if (slot >= p.maxOpen) revert TooManyOpen();
        _rollDay();
        if (int256(netLossToday) >= int256(uint256(p.dailyLossLimit))) revert DailyLossHalt(); // GUARD:I5
        // effects
        pl.credit -= b.stake;
        pl.openStake += b.stake;
        pl.openMask = open | uint32(1 << slot);
        uint256 sh = 128 * (slot & 1);
        uint256 rec = uint256(b.k) | (uint256(uint32(b.j)) << 32) | (uint256(b.stake) << 64) | (uint256(mult) << 96) | (uint256(b.asset) << 112);
        pl.bets[slot >> 1] = (pl.bets[slot >> 1] & ~(uint256(type(uint128).max) << sh)) | (rec << sh);
        totalCredit -= b.stake;
        totalOpen += b.stake;
        emit BetPlaced(b.player, b.asset, b.k, b.j, b.stake, mult, b.nonce, uint8(slot));
    }

    /// Opens the column on its first bet, then books the liability (I7) and the house's worst case (I-solv).
    function _book(Bet calldata b, uint64 refPriceE8, uint64 payout, Market memory m) internal {
        Params storage p = params;
        Column storage c = _column(b.asset, b.k);
        if (c.state == 0) {
            c.state = OPEN;
            c.bJ0 = int32(HexGeo.floorDiv(int256(uint256(refPriceE8)), m.rowE8) - 128);
        }
        int256 off = int256(b.j) - c.bJ0;
        if (off < 0 || off > 255) revert NotQuoted();
        uint256 sh = 32 * (uint256(off) & 7);
        uint256 w = c.liab[uint256(off) >> 3];
        uint256 hexLiab = uint32(w >> sh) + uint256(payout);
        if (hexLiab > p.maxHexLiab) revert HexCap(); // GUARD:I7
        uint64 colLiab = c.totalLiab + payout;
        if (colLiab > p.maxColLiab) revert ColumnCap(); // GUARD:I7
        uint64 al = m.openLiab + payout;
        if (al > m.maxLiab) revert AssetCap(); // GUARD:I7
        uint64 mkt = openLiability + payout;
        if (mkt > p.maxMarketLiab) revert MarketCap(); // GUARD:I7
        uint64 hl = houseLiab + (payout - uint64(b.stake));
        if (hl > house) revert HouseCapacity(); // GUARD:ISOLV
        c.liab[uint256(off) >> 3] = (w & ~(uint256(type(uint32).max) << sh)) | (hexLiab << sh);
        c.totalLiab = colLiab;
        markets[b.asset].openLiab = al;
        openLiability = mkt;
        houseLiab = hl;
    }

    // ------------------------------------------------------------------ settlement (permissionless; never paused, I3)
    /// Decides column k from the recorder-signed tape (first call), then settles the listed players' open bets on k.
    /// Once k is decided the tape arguments are ignored, so later calls only settle more players.
    /// Tape = every grid tick from the last at or before t_lo(k) through the first at or after t_hi(k).
    function settleColumn(uint8 asset, uint32 k, uint64[] calldata ts, uint64[] calldata px, bytes calldata recorderSig, address[] calldata players) external {
        Column storage c = _column(asset, k);
        if (c.state < SETTLED) {
            Market memory m = markets[asset];
            uint256 n = ts.length;
            if (n < 2 || px.length != n) revert BadTape();
            uint256 nowMs = block.timestamp * 1000;
            if (int256(nowMs) > HexGeo.tHi(k) + int256(uint256(params.voidAfterMs))) revert TooLate();
            if (ts[n - 1] > nowMs + 1000) revert TickInFuture();
            address signer = _recover(keccak256(abi.encode(TAPE_TYPEHASH, asset, k, _checkedTicksHash(ts, px, m.maxMoveE8))), recorderSig);
            Params storage p = params;
            uint8 off = disabled;
            if (!(signer == p.recorders[0] && off & 1 == 0) && !(signer == p.recorders[1] && off & 2 == 0)
                && !(signer == p.recorders[2] && off & 4 == 0)) revert NotRecorder(); // GUARD:I11
            if (int256(uint256(ts[0])) > HexGeo.tLo(k) || int256(uint256(ts[n - 1])) < HexGeo.tHi(k)) revert BadTape(); // GUARD:I11
            int32 bJ0 = c.bJ0;
            (uint256 touched, bool gap,) = _applyTape(asset, m.rowE8, k, bJ0, ts, px);
            c.state = SETTLED;
            c.gap = gap;
            if (touched != 0) c.touched = touched;
            emit ColumnSettled(asset, k, bJ0, gap, touched);
        }
        _settlePlayers(asset, k, c, players);
    }

    /// No valid tape within voidAfterMs after t_hi(k): anyone may VOID k, refunding every open bet on it.
    function voidColumn(uint8 asset, uint32 k, address[] calldata players) external {
        Column storage c = _column(asset, k);
        if (c.state < SETTLED) {
            if (int256(block.timestamp * 1000) <= HexGeo.tHi(k) + int256(uint256(params.voidAfterMs))) revert TooEarly();
            c.state = VOIDED;
            emit ColumnVoided(asset, k);
        }
        _settlePlayers(asset, k, c, players);
    }

    /// One pass over the tape: I11 (100 ms grid, strictly increasing, |Δp|·100 <= maxMoveE8·Δt) and
    /// ticksHash = keccak256(abi.encodePacked(uint64 ts0, uint64 px0, uint64 ts1, uint64 px1, ...)), 16 bytes per tick.
    /// Each calldata element is read once (reads dominate this loop's gas).
    function _checkedTicksHash(uint64[] calldata ts, uint64[] calldata px, uint256 maxMove) internal pure returns (bytes32 h) {
        uint256 n = ts.length;
        bytes memory buf = new bytes(16 * n + 16); // +16: the last 32-byte store spills 16 bytes
        uint256 pt;
        uint256 pp;
        for (uint256 i; i < n; ++i) {
            uint256 t = ts[i];
            uint256 q = px[i];
            if (t % 100 != 0) revert OffGrid(); // GUARD:I11
            if (i != 0) {
                if (t <= pt) revert TickNotNewer(); // GUARD:I11
                uint256 mv = q > pp ? q - pp : pp - q;
                if (mv * 100 > maxMove * (t - pt)) revert MoveTooLarge(); // GUARD:I11
            }
            assembly ("memory-safe") { mstore(add(add(buf, 32), mul(i, 16)), or(shl(192, t), shl(128, q))) }
            (pt, pp) = (t, q);
        }
        assembly ("memory-safe") { h := keccak256(add(buf, 32), mul(n, 16)) }
    }

    /// SPEC §6.3 over a contiguous tape for column k (hexgeo.rs apply_segment on every consecutive pair). Touched bits
    /// before a gap are kept; a gap blocks later touches. chainTs is returned for the vector tests (PENDING detection).
    function _applyTape(uint8 asset, int256 row, uint256 k, int256 bJ0, uint64[] calldata ts, uint64[] calldata px) internal returns (uint256 touched, bool gap, int256 chainTs) {
        int256 gapMs = int256(uint256(params.gapMs));
        int256 t1 = int256(uint256(ts[0]));
        int256 p1 = int256(uint256(px[0]));
        for (uint256 i = 1; i < ts.length; ++i) {
            int256 t0 = t1;
            int256 p0 = p1;
            t1 = int256(uint256(ts[i]));
            p1 = int256(uint256(px[i]));
            if (t1 < HexGeo.tLo(k) || t0 > HexGeo.tHi(k)) continue;
            if (!gap) {
                // a long segment, or observation that began inside the span (a contiguous tape never skips a segment)
                if (t1 - t0 > gapMs || (chainTs == 0 && t0 > HexGeo.tLo(k))) gap = true;
                else touched = _touch(asset, row, k, bJ0, t0, p0, t1, p1, touched);
            }
            chainTs = t1;
        }
    }

    function _touch(uint8 asset, int256 row, uint256 k, int256 bJ0, int256 t0, int256 p0, int256 t1, int256 p1, uint256 touched) internal returns (uint256) {
        (int256 pmin, int256 pmax) = p0 < p1 ? (p0, p1) : (p1, p0);
        (int256 ja, int256 jb) = HexGeo.bandRange(k, pmin, pmax, row);
        int256 x = HexGeo.floorDiv(pmin, row) - 2;
        if (ja < x) ja = x;
        if (ja < bJ0) ja = bJ0;
        x = HexGeo.floorDiv(pmax, row) + 1;
        if (jb > x) jb = x;
        if (jb > bJ0 + 255) jb = bJ0 + 255;
        for (int256 j = ja; j <= jb; ++j) {
            uint256 bit = uint256(j - bJ0);
            if ((touched >> bit) & 1 == 0 && HexGeo.segHits(t0, p0, t1, p1, int256(k), j, row)) {
                touched |= 1 << bit;
                emit HexTouched(asset, uint32(k), int32(j), uint64(uint256(t1)));
            }
        }
        return touched;
    }

    /// SPEC §4 settle_player for column (asset, k): WIN if the band was touched, else VOID on a gap, else LOSS; VOID if
    /// voided. Pre-markets bet records have asset bits 0, so they are SOL bets.
    function _settlePlayers(uint8 asset, uint32 k, Column storage c, address[] calldata players) internal {
        _rollDay();
        uint256 col = uint256(k) | (uint256(asset) << 112);
        uint64 al = markets[asset].openLiab;
        bool voided = c.state == VOIDED;
        bool gap = c.gap;
        uint256 touched = c.touched;
        int256 bJ0 = c.bJ0;
        uint64 h = house;
        uint64 hl = houseLiab;
        uint64 tc = totalCredit;
        uint64 to = totalOpen;
        uint64 ol = openLiability;
        int64 net = netLossToday;
        for (uint256 x; x < players.length; ++x) {
            Player storage pl = _player(players[x]);
            uint32 mask0 = pl.openMask;
            uint32 mask = mask0;
            uint64 credit = pl.credit;
            uint64 openStake = pl.openStake;
            for (uint256 i; i < 32 && (mask0 >> i) != 0; ++i) {
                if ((mask0 >> i) & 1 == 0) continue;
                uint256 rec = uint128(pl.bets[i >> 1] >> (128 * (i & 1)));
                if (rec & BET_COLUMN != col) continue;
                int32 j = int32(uint32(rec >> 32));
                uint64 stake = uint32(rec >> 64);
                uint16 mult = uint16(rec >> 96);
                uint64 payout = uint64(uint256(stake) * mult / 100);
                uint8 out = voided ? 3 : (touched >> uint256(int256(j) - bJ0)) & 1 == 1 ? 1 : gap ? 3 : 2;
                uint64 credited;
                if (out == 1) { credited = payout; h -= payout - stake; net += int64(payout - stake); }
                else if (out == 2) { h += stake; net -= int64(stake); }
                else credited = stake;
                credit += credited;
                tc += credited;
                openStake -= stake;
                to -= stake;
                hl -= payout - stake;
                ol -= payout;
                al -= payout;
                mask &= ~uint32(1 << i);
                emit BetSettled(players[x], asset, k, j, stake, mult, uint8(i), out, credited);
            }
            if (mask != mask0) {
                pl.openMask = mask;
                pl.credit = credit;
                pl.openStake = openStake;
            }
        }
        house = h;
        houseLiab = hl;
        totalCredit = tc;
        totalOpen = to;
        openLiability = ol;
        markets[asset].openLiab = al;
        netLossToday = net;
    }

    function _rollDay() internal {
        uint32 d = uint32(block.timestamp / 86400);
        if (day != d) { day = d; netLossToday = 0; }
    }

    // ------------------------------------------------------------------ signatures / nonces / storage
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    /// Malformed or malleable (high-s) signatures revert BadSig, so the returned signer is never address(0).
    function _recover(bytes32 structHash, bytes calldata sig) internal view returns (address signer) {
        ECDSA.RecoverError err;
        (signer, err,) = ECDSA.tryRecoverCalldata(keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash)), sig);
        if (err != ECDSA.RecoverError.NoError) revert BadSig(); // GUARD:SIG
    }

    function _verify(bytes32 structHash, bytes calldata sig, address who) internal view {
        if (_recover(structHash, sig) != who) revert BadSig(); // GUARD:SIG
    }

    /// Unordered nonces in a 32-wide window shared by Bet, Withdraw and Deposit, so bets may land in any order.
    function _useNonce(Player storage pl, uint64 nonce) internal {
        uint256 base = pl.nonceBase;
        if (nonce < base || nonce >= base + 32) revert NonceUsed(); // GUARD:NONCE
        uint32 bit = uint32(1 << (nonce - base));
        uint32 mask = pl.nonceMask;
        if (mask & bit != 0) revert NonceUsed(); // GUARD:NONCE
        mask |= bit;
        while (mask & 1 == 1) { mask >>= 1; ++base; }
        pl.nonceBase = uint48(base);
        pl.nonceMask = mask;
    }

    /// MIP-8 prices storage by 128-slot page (8,100 gas per cold page). Each player (17 slots) and column (34 slots)
    /// starts on its own page boundary, so it never straddles two pages. Same idea as ERC-7201's aligned roots.
    /// A column's key is k | asset << 32, so asset 0 keeps every pre-markets (SOL) column at its old slot.
    function _player(address who) internal pure returns (Player storage pl) {
        bytes32 s = keccak256(abi.encode(who, PLAYERS)) & ~bytes32(uint256(127));
        assembly ("memory-safe") { pl.slot := s }
    }

    function _column(uint8 asset, uint32 k) internal pure returns (Column storage c) {
        bytes32 s = keccak256(abi.encode(uint256(k) | (uint256(asset) << 32), COLUMNS)) & ~bytes32(uint256(127));
        assembly ("memory-safe") { c.slot := s }
    }

    // ------------------------------------------------------------------ views
    function getParams() external view returns (Params memory) { return params; }

    function playerOf(address who) external view returns (uint64 credit, uint64 openStake, uint48 nonceBase, uint32 nonceMask, uint32 openMask, bool granted, uint256[16] memory bets) {
        Player storage pl = _player(who);
        return (pl.credit, pl.openStake, pl.nonceBase, pl.nonceMask, pl.openMask, pl.granted, pl.bets);
    }

    function columnOf(uint8 asset, uint32 k) external view returns (int32 bJ0, uint8 state, bool gap, uint64 totalLiab, uint256 touched) {
        Column storage c = _column(asset, k);
        return (c.bJ0, c.state, c.gap, c.totalLiab, c.touched);
    }
}
