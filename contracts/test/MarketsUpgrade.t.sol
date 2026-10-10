// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {HexGeo} from "../src/HexGeo.sol";
import {hexitMarkets} from "../script/Markets.sol";
import {Base} from "./Base.t.sol";

/// The pre-markets ABI: the implementation live on Monad testnet until the markets upgrade.
interface ILegacyGame {
    struct Bet { address player; uint32 k; int32 j; uint64 stake; uint16 minMult; uint64 nonce; uint64 deadline; }
    struct Quote { uint32 k; int32 qJ0; uint64 refTsMs; uint64 refPriceE8; uint64 expiresMs; }
    function placeBetFor(Bet calldata b, bytes calldata sig, Quote calldata q, uint16[64] calldata mults, bytes calldata quoterSig) external;
    function settleColumn(uint32 k, uint64[] calldata ts, uint64[] calldata px, bytes calldata recorderSig, address[] calldata players) external;
    function columnOf(uint32 k) external view returns (int32 bJ0, uint8 state, bool gap, uint64 totalLiab, uint256 touched);
}

/// The markets upgrade, run on the exact bytecode that is live on testnet. test/fixtures holds the creation code of
/// implementation 0xba00953704615bBDBd2d32b0F54DB681B6F210e8, taken from deployments/build-info-testnet-20261009;
/// its runtime equals the chain's code, apart from the implementation's own address in the UUPS immutable.
/// SOL state made on the old code: credit, nonces, a decided column with a player still unsettled, an open bet that
/// settles after the upgrade and one that VOIDs. Then the upgrade runs, with the same market list Upgrade.s.sol sends.
contract MarketsUpgradeTest is Base {
    string constant OLD_BET_T = "Bet(address player,uint32 k,int32 j,uint64 stake,uint16 minMult,uint64 nonce,uint64 deadline)";
    string constant OLD_QUOTE_T = "Quote(uint32 k,int32 qJ0,uint64 refTsMs,uint64 refPriceE8,uint64 expiresMs,bytes32 multsHash)";
    string constant OLD_TAPE_T = "ColumnTape(uint32 k,bytes32 ticksHash)";
    bytes32 constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    uint64 constant BTC_PX = 8_238_500_000_000;
    uint64 constant MON_PX = 2_436_100;

    Vm.Wallet carol = vm.createWallet("carol");
    Vm.Wallet dave = vm.createWallet("dave");
    ILegacyGame old;

    function setUp() public override {
        super.setUp();
        bytes memory code = vm.parseBytes(vm.readFile("test/fixtures/HexitGame-testnet-20261009.hex"));
        address impl;
        assembly ("memory-safe") { impl := create(0, add(code, 32), mload(code)) }
        require(impl != address(0), "legacy implementation did not deploy");
        game = HexitGame(address(new ERC1967Proxy(impl, abi.encodeCall(HexitGame.initialize, (owner, address(usdc), ROW, _params())))));
        old = ILegacyGame(address(game));
        dom = _domain(block.chainid, address(game));
        vm.startPrank(owner);
        usdc.setMinter(address(game), true);
        usdc.mint(owner, HOUSE);
        usdc.approve(address(game), HOUSE);
        game.houseDeposit(HOUSE);
        vm.stopPrank();
    }

    function _oldBet(Vm.Wallet memory w, uint32 k, int32 j, uint64 stake, uint64 nonce) internal {
        uint256 nowMs = vm.getBlockTimestamp() * 1000;
        ILegacyGame.Bet memory b = ILegacyGame.Bet(w.addr, k, j, stake, 101, nonce, uint64(nowMs / 1000 + 10));
        ILegacyGame.Quote memory q = ILegacyGame.Quote(k, 2368, uint64(nowMs), PRICE, uint64(nowMs + 1500));
        uint16[64] memory m = _mults(200);
        bytes memory s = _sign(w.privateKey, keccak256(abi.encode(keccak256(bytes(OLD_BET_T)), b.player, b.k, b.j, b.stake, b.minMult, b.nonce, b.deadline)));
        bytes32 mh = keccak256(abi.encodePacked(m));
        bytes memory qs = _sign(quoter.privateKey, keccak256(abi.encode(keccak256(bytes(OLD_QUOTE_T)), q.k, q.qJ0, q.refTsMs, q.refPriceE8, q.expiresMs, mh)));
        vm.prank(relayer);
        old.placeBetFor(b, s, q, m, qs);
    }

    function _oldTapeSig(uint32 k, uint64[] memory ts, uint64[] memory px) internal view returns (bytes memory) {
        return _sign(recorder.privateKey, keccak256(abi.encode(keccak256(bytes(OLD_TAPE_T)), k, _ticksHash(ts, px))));
    }

    function _get(bytes memory cd) internal view returns (bytes memory r) {
        bool ok;
        (ok, r) = address(game).staticcall(cd);
        require(ok, "view reverted");
    }

    /// Every stored value a pre-markets reader can see: counters, roles, params, domain, the four players (credit,
    /// open stake, nonce window, open mask, bet words) and SOL columns k0..k0+2 (read through the old or new columnOf).
    function _views(uint32 k0, bool upgraded) internal view returns (bytes memory out) {
        string[14] memory sigs = ["house()", "houseLiab()", "totalCredit()", "totalOpen()", "openLiability()", "netLossToday()",
            "day()", "paused()", "disabled()", "rowE8()", "usdc()", "owner()", "getParams()", "domainSeparator()"];
        for (uint256 i; i < sigs.length; ++i) out = bytes.concat(out, _get(abi.encodeWithSignature(sigs[i])));
        address[4] memory who = [alice.addr, bob.addr, carol.addr, dave.addr];
        for (uint256 i; i < 4; ++i) out = bytes.concat(out, _get(abi.encodeCall(HexitGame.playerOf, (who[i]))));
        for (uint32 k = k0; k < k0 + 3; ++k) {
            out = bytes.concat(out, _get(upgraded ? abi.encodeCall(HexitGame.columnOf, (0, k)) : abi.encodeCall(ILegacyGame.columnOf, (k))));
        }
    }

    function test_markets_upgrade_from_live_bytecode() public {
        // ---- the old code: SOL play
        _grant(alice.addr); _grant(bob.addr); _grant(carol.addr); _grant(dave.addr);
        vm.prank(alice.addr); game.withdraw(1e6);
        uint32 k0 = _openK();
        _oldBet(carol, k0, _flatBand(k0, PRICE), 2e6, 0);                          // WIN, settled before the upgrade
        _oldBet(dave, k0, _flatBand(k0, PRICE) + 2, 1e6, 0);                       // LOSS, left on the decided column
        _oldBet(alice, k0 + 1, _flatBand(k0 + 1, PRICE), 5e6, 0);                  // open: WIN after the upgrade
        _oldBet(alice, k0 + 1, _flatBand(k0 + 1, PRICE) + 3, 1e6, 1);              // open: LOSS after the upgrade
        _oldBet(bob, k0 + 2, 2400, 3e6, 0);                                        // open: VOID after the upgrade
        _afterSpan(k0);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k0, PRICE);
        old.settleColumn(k0, ts, px, _oldTapeSig(k0, ts, px), _one(carol.addr));
        vm.startPrank(guardian);
        game.setPause(1, true);                                                    // deposit pause and a kill bit carry over
        game.setDisabled(4, true);
        vm.stopPrank();
        uint64 open = game.openLiability();
        assertEq(open, 2e6 + 10e6 + 2e6 + 6e6);
        bytes memory before = _views(k0, false);

        // ---- the upgrade
        (uint8[] memory ids, HexitGame.MarketConfig[] memory cs) = hexitMarkets();
        address impl = address(new HexitGame());
        bytes memory init = abi.encodeCall(HexitGame.initializeMarkets, (ids, cs));
        vm.prank(alice.addr);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, alice.addr));
        game.upgradeToAndCall(impl, init);
        vm.prank(owner); game.upgradeToAndCall(impl, init);
        assertEq(address(uint160(uint256(vm.load(address(game), IMPL_SLOT)))), impl);
        assertEq(_views(k0, true), before, "state preserved");
        vm.prank(owner); vm.expectRevert(Initializable.InvalidInitialization.selector); game.initializeMarkets(ids, cs);
        (int64 row, uint56 move, bool on, uint64 cap, uint64 liab) = game.markets(0);
        assertEq(abi.encode(row, move, on, cap, liab), abi.encode(ROW, uint56(25_000_000), false, uint64(100_000_000_000), open));
        for (uint256 i; i < 2; ++i) {
            (row, move, on, cap, liab) = game.markets(ids[i]);
            assertEq(abi.encode(row, move, on, cap, liab), abi.encode(cs[i].rowE8, cs[i].maxMoveE8, true, cs[i].maxLiab, uint64(0)));
        }
        assertEq(abi.encode(ids.length, ids[0], ids[1]), abi.encode(2, 1, 3));          // BTC and MON

        // ---- the old ABI is gone and SOL takes no new bets
        vm.expectRevert(); old.columnOf(k0);
        _betOn(alice, 0, ROW, PRICE, _openK() + 2, 2400, 1e6, 2, HexitGame.MarketClosed.selector);

        // ---- every pre-upgrade SOL bet still closes: stored result, asset-0 tape, VOID
        game.settleColumn(0, k0, new uint64[](0), new uint64[](0), "", _one(dave.addr));
        assertEq(_credit(dave.addr), 99e6);
        vm.warp(uint256(HexGeo.tHi(k0 + 2)) / 1000 + 1);
        (ts, px) = _flatTape(k0 + 1, PRICE);
        bytes memory oldSig = _oldTapeSig(k0 + 1, ts, px);
        vm.expectRevert(HexitGame.NotRecorder.selector); game.settleColumn(0, k0 + 1, ts, px, oldSig, _one(alice.addr));
        _settleOn(0, k0 + 1, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 100e6 - 1e6 - 6e6 + 10e6);
        vm.warp(uint256(HexGeo.tHi(k0 + 2) + 120_000) / 1000 + 1);
        game.voidColumn(0, k0 + 2, _one(bob.addr));
        assertEq(_credit(bob.addr), 100e6);
        assertEq(_credit(carol.addr), 102e6);
        (,,,, liab) = game.markets(0);
        assertEq(liab, 0);
        assertEq(game.openLiability(), 0);
        assertEq(game.totalOpen(), 0);

        // ---- BTC and MON on the same credit balance
        uint32 k = _openK();
        int32 jb = _flatBand(k, BTC_PX, cs[0].rowE8);
        int32 jm = _flatBand(k, MON_PX, cs[1].rowE8);
        _betOn(alice, 1, cs[0].rowE8, BTC_PX, k, jb, 4e6, 2, 0);
        _betOn(alice, 3, cs[1].rowE8, MON_PX, k, jm, 2e6, 3, 0);
        assertEq(_credit(alice.addr), 103e6 - 6e6);
        _afterSpan(k);
        (ts, px) = _flatTape(k, BTC_PX);
        _settleOn(1, k, ts, px, _one(alice.addr));
        (ts, px) = _flatTape(k, MON_PX);
        _settleOn(3, k, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 97e6 + 8e6 + 4e6);
        assertEq(game.house(), HOUSE - 2e6 + 1e6 - 5e6 + 1e6 - 4e6 - 2e6);
        _assertTreasury();
    }
}
