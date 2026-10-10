// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {HexGeo} from "../src/HexGeo.sol";

/// Shared deployment (testnet params, SPEC-MONAD §3.3 adapted) and EIP-712 signing helpers.
abstract contract Base is Test {
    uint256 constant CHAIN = 10143;
    int64 constant ROW = 5_000_000;
    uint256 constant T0 = 1_790_000_000;            // block.timestamp at setUp (s)
    uint64 constant PRICE = 12_002_250_000;         // 120.0225 USD: band 2400 (row 0.05)
    uint64 constant HOUSE = 10_000_000e6;
    uint8 constant A = 1;                           // the unit tests' market: BTC's id, at the 0.05 row the vectors use

    address owner = makeAddr("owner");
    address guardian = makeAddr("guardian");
    address relayer = makeAddr("relayer");
    address keeper = makeAddr("keeper");
    Vm.Wallet recorder = vm.createWallet("recorder");
    Vm.Wallet quoter = vm.createWallet("quoter");
    Vm.Wallet alice = vm.createWallet("alice");
    Vm.Wallet bob = vm.createWallet("bob");

    // EIP-712 type strings exactly as documented in README.md (the tests hash these, not the contract's constants)
    string constant BET_T = "Bet(address player,uint8 asset,uint32 k,int32 j,uint64 stake,uint16 minMult,uint64 nonce,uint64 deadline)";
    string constant QUOTE_T = "Quote(uint8 asset,int64 rowE8,uint32 k,int32 qJ0,uint64 refTsMs,uint64 refPriceE8,uint64 expiresMs,bytes32 multsHash)";
    string constant TAPE_T = "ColumnTape(uint8 asset,uint32 k,bytes32 ticksHash)";
    string constant WITHDRAW_T = "Withdraw(address player,uint64 amount,uint64 nonce,uint64 deadline)";
    string constant DEPOSIT_T = "Deposit(address player,uint64 amount,uint64 nonce,uint64 deadline)";

    TestUSDC usdc;
    HexitGame game;
    bytes32 dom;                                    // game domain separator, computed locally

    function _params() internal view returns (HexitGame.Params memory p) {
        p.recorders = [recorder.addr, address(0), address(0)];
        p.quoter = quoter.addr;
        p.guardian = guardian;
        p.relayer = relayer;
        p.minStake = 100_000;
        p.maxStake = 50_000_000;
        p.maxPayout = 2_500_000_000;
        p.maxHexLiab = 4_000_000_000;
        p.maxColLiab = 20_000_000_000;
        p.maxMarketLiab = 100_000_000_000;
        p.dailyLossLimit = 1_000_000_000_000;
        p.maxMoveE8 = 25_000_000;
        p.voidAfterMs = 120_000;
        p.gapMs = 250;
        p.quoteMaxAgeMs = 1_500;
        p.lockMarginMs = 1_000;
        p.maxOpen = 32;
    }

    /// Market settings: tape move limit 5 bands per 100 ms (25,000,000 at ROW), cap 100,000 tUSDC, open.
    function _cfg(int64 row) internal pure returns (HexitGame.MarketConfig memory) {
        return HexitGame.MarketConfig(row, uint56(uint64(5 * row)), 100_000_000_000, true);
    }

    function _list(uint8 a, HexitGame.MarketConfig memory c) internal pure returns (uint8[] memory ids, HexitGame.MarketConfig[] memory cs) {
        ids = new uint8[](1);
        cs = new HexitGame.MarketConfig[](1);
        (ids[0], cs[0]) = (a, c);
    }

    function setUp() public virtual {
        vm.chainId(CHAIN);
        vm.warp(T0);
        usdc = TestUSDC(address(new ERC1967Proxy(address(new TestUSDC()), abi.encodeCall(TestUSDC.initialize, (owner)))));
        game = HexitGame(address(new ERC1967Proxy(address(new HexitGame()), abi.encodeCall(HexitGame.initialize, (owner, address(usdc), ROW, _params())))));
        vm.startPrank(owner);
        (uint8[] memory ids, HexitGame.MarketConfig[] memory cs) = _list(A, _cfg(ROW));
        game.initializeMarkets(ids, cs);
        usdc.setMinter(address(game), true);
        usdc.mint(owner, HOUSE);
        usdc.approve(address(game), type(uint256).max);
        game.houseDeposit(HOUSE);
        vm.stopPrank();
        dom = _domain(block.chainid, address(game));
    }

    function _domain(uint256 chainId, address verifying) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Hexit"), keccak256("1"), chainId, verifying));
    }

    // ------------------------------------------------------------------ time / columns
    function _nowMs() internal view returns (uint256) { return block.timestamp * 1000; }

    /// First column a bet placed now may take (lock: tLo >= now + 6.1 s).
    function _openK() internal view returns (uint32) {
        return uint32(uint256(HexGeo.ceilDiv(int256(_nowMs()) + 6100 + 834, 5000)));
    }

    /// Moves block time to just after column k's span (a tape for k can now be settled).
    function _afterSpan(uint32 k) internal { vm.warp(uint256(HexGeo.tHi(k)) / 1000 + 1); }

    // ------------------------------------------------------------------ signing
    function _sign(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        return _signDom(key, dom, structHash);
    }

    function _signDom(uint256 key, bytes32 d, bytes32 structHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", d, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _betHash(HexitGame.Bet memory b) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(bytes(BET_T)), b.player, b.asset, b.k, b.j, b.stake, b.minMult, b.nonce, b.deadline));
    }

    function _quoteHash(HexitGame.Quote memory q, uint16[64] memory m) internal pure returns (bytes32) {
        bytes32 mh = keccak256(abi.encodePacked(m));
        return keccak256(abi.encode(keccak256(bytes(QUOTE_T)), q.asset, q.rowE8, q.k, q.qJ0, q.refTsMs, q.refPriceE8, q.expiresMs, mh));
    }

    function _mults(uint16 v) internal pure returns (uint16[64] memory m) { for (uint256 i; i < 64; ++i) m[i] = v; }

    /// A fresh quote for column (asset, k) around price px (qJ0 = band - 32 at that row), every band at mult.
    function _quote(uint8 asset, int64 row, uint32 k, uint64 px, uint16 mult) internal view returns (HexitGame.Quote memory q, uint16[64] memory m) {
        q = HexitGame.Quote(asset, row, k, int32(int256(uint256(px)) / row) - 32, uint64(_nowMs()), px, uint64(_nowMs() + 1500));
        m = _mults(mult);
    }

    /// Bet + fresh 2x quote at PRICE on market A, ready to edit before _submit.
    function _pieces(Vm.Wallet memory w, uint32 k, int32 j, uint64 stake, uint64 nonce)
        internal view returns (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m)
    {
        b = HexitGame.Bet(w.addr, A, k, j, stake, 101, nonce, uint64(block.timestamp + 10));
        (q, m) = _quote(A, ROW, k, PRICE, 200);
    }

    /// Signs with the player key and the quoter key, submits from the relayer; expects `err` (0 = must succeed).
    function _submit(HexitGame.Bet memory b, uint256 pk, HexitGame.Quote memory q, uint16[64] memory m, uint256 qk, bytes4 err) internal {
        bytes memory s = _sign(pk, _betHash(b));
        bytes memory qs = _sign(qk, _quoteHash(q, m));
        if (err != 0) vm.expectRevert(err);
        vm.prank(relayer);
        game.placeBetFor(b, s, q, m, qs);
    }

    /// Relayed bet with a fresh 2x quote at PRICE.
    function _bet(Vm.Wallet memory w, uint32 k, int32 j, uint64 stake, uint64 nonce) internal {
        _betAt(w, k, j, stake, nonce, 200);
    }

    function _betAt(Vm.Wallet memory w, uint32 k, int32 j, uint64 stake, uint64 nonce, uint16 mult) internal {
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(w, k, j, stake, nonce);
        m = _mults(mult);
        _submit(b, w.privateKey, q, m, quoter.privateKey, 0);
    }

    /// A relayed bet on any market, quoted at px with 2x on every band; expects `err` (0 = must succeed).
    function _betOn(Vm.Wallet memory w, uint8 asset, int64 row, uint64 px, uint32 k, int32 j, uint64 stake, uint64 nonce, bytes4 err) internal {
        HexitGame.Bet memory b = HexitGame.Bet(w.addr, asset, k, j, stake, 101, nonce, uint64(vm.getBlockTimestamp() + 10)); // via_ir caches block.timestamp across vm.warp
        (HexitGame.Quote memory q, uint16[64] memory m) = _quote(asset, row, k, px, 200);
        _submit(b, w.privateKey, q, m, quoter.privateKey, err);
    }

    function _grant(address p) internal { vm.prank(relayer); game.grant(p); }

    function _withdrawSig(Vm.Wallet memory w, uint64 amount, uint64 nonce, uint64 deadline) internal view returns (bytes memory) {
        return _sign(w.privateKey, keccak256(abi.encode(keccak256(bytes(WITHDRAW_T)), w.addr, amount, nonce, deadline)));
    }

    function _depositSig(Vm.Wallet memory w, uint64 amount, uint64 nonce, uint64 deadline) internal view returns (bytes memory) {
        return _sign(w.privateKey, keccak256(abi.encode(keccak256(bytes(DEPOSIT_T)), w.addr, amount, nonce, deadline)));
    }

    /// tUSDC EIP-2612 permit for the game (makes external calls: build it before vm.expectRevert).
    function _permit(Vm.Wallet memory w, uint256 value, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 sh = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            w.addr, address(game), value, usdc.nonces(w.addr), deadline));
        (v, r, s) = vm.sign(w.privateKey, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), sh)));
    }

    // ------------------------------------------------------------------ tapes
    function _ticksHash(uint64[] memory ts, uint64[] memory px) internal pure returns (bytes32) {
        bytes memory b;
        for (uint256 i; i < ts.length; ++i) b = abi.encodePacked(b, ts[i], px[i]);
        return keccak256(b);
    }

    function _tapeSig(uint256 key, uint32 k, uint64[] memory ts, uint64[] memory px) internal view returns (bytes memory) {
        return _tapeSigOn(key, A, k, ts, px);
    }

    function _tapeSigOn(uint256 key, uint8 asset, uint32 k, uint64[] memory ts, uint64[] memory px) internal view returns (bytes memory) {
        return _sign(key, keccak256(abi.encode(keccak256(bytes(TAPE_T)), asset, k, _ticksHash(ts, px))));
    }

    /// Grid tape covering column k (last tick <= tLo through first >= tHi), flat at px.
    function _flatTape(uint32 k, uint64 px) internal pure returns (uint64[] memory ts, uint64[] memory p) {
        uint256 a = uint256(5000) * k - 900;
        uint256 n = 69;
        ts = new uint64[](n);
        p = new uint64[](n);
        for (uint256 i; i < n; ++i) { ts[i] = uint64(a + 100 * i); p[i] = px; }
    }

    /// The band a flat tape at px touches in column k (even k: [j, j+1] rows; odd k: [j+.5, j+1.5]).
    function _flatBand(uint32 k, uint64 px) internal pure returns (int32) { return _flatBand(k, px, ROW); }

    function _flatBand(uint32 k, uint64 px, int64 row) internal pure returns (int32) {
        int256 p2 = 2 * int256(uint256(px)) / row;      // price in half-rows
        return int32(k % 2 == 0 ? p2 / 2 : (p2 - 1) / 2);
    }

    function _settle(uint32 k, uint64[] memory ts, uint64[] memory px, address[] memory who) internal {
        _settleOn(A, k, ts, px, who);
    }

    function _settleOn(uint8 asset, uint32 k, uint64[] memory ts, uint64[] memory px, address[] memory who) internal {
        game.settleColumn(asset, k, ts, px, _tapeSigOn(recorder.privateKey, asset, k, ts, px), who);
    }

    function _one(address a) internal pure returns (address[] memory r) { r = new address[](1); r[0] = a; }
    function _two(address a, address b) internal pure returns (address[] memory r) { r = new address[](2); r[0] = a; r[1] = b; }

    function _credit(address p) internal view returns (uint64 c) { (c,,,,,,) = game.playerOf(p); }
    function _openMask(address p) internal view returns (uint32 m) { (,,,, m,,) = game.playerOf(p); }

    /// I1 with equality (no donations in unit tests).
    function _assertTreasury() internal view {
        assertEq(usdc.balanceOf(address(game)), uint256(game.house()) + game.totalCredit() + game.totalOpen(), "I1");
        assertLe(game.houseLiab(), game.house(), "I-solv");
    }
}
