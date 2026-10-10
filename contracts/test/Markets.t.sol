// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Vm, stdError} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {HexGeo} from "../src/HexGeo.sol";
import {Base} from "./Base.t.sol";

/// Markets: listing and tuning (setMarket, initializeMarkets), MarketClosed, AssetCap, MarketBusy, the asset in every
/// signature, and BTC + MON live at once on one credit balance with independent columns.
contract MarketsTest is Base {
    uint8 constant BTC = 1;
    uint8 constant MON = 3;
    int64 constant BTC_ROW = 2_500_000_000;          // $25
    uint64 constant BTC_PX = 8_238_500_000_000;      // $82,385
    int64 constant MON_ROW = 2_000;                  // $0.00002
    uint64 constant MON_PX = 2_436_100;              // $0.024361 (1218.05 bands: off every band edge)

    function _notOwner(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, who);
    }

    function _setM(uint8 asset, HexitGame.MarketConfig memory c) internal { vm.prank(owner); game.setMarket(asset, c); }

    function _market(uint8 asset) internal view returns (HexitGame.Market memory m) {
        (m.rowE8, m.maxMoveE8, m.enabled, m.maxLiab, m.openLiab) = game.markets(asset);
    }

    function _bothListed() internal {
        _setM(BTC, _cfg(BTC_ROW));
        _setM(MON, _cfg(MON_ROW));
        _grant(alice.addr);
    }

    // ================================================================== listing
    function test_initializeMarkets_fresh_deploy() public {
        HexitGame.Market memory m = _market(0);                                    // Base.setUp ran it
        assertEq(abi.encode(m), abi.encode(HexitGame.Market(ROW, 25_000_000, false, 100_000_000_000, 0)));
        m = _market(A);
        assertEq(abi.encode(m), abi.encode(HexitGame.Market(ROW, 25_000_000, true, 100_000_000_000, 0)));
        assertEq(_market(2).rowE8, 0);                                             // never listed
        (uint8[] memory ids, HexitGame.MarketConfig[] memory cs) = _list(MON, _cfg(MON_ROW));
        vm.prank(owner); vm.expectRevert(Initializable.InvalidInitialization.selector); game.initializeMarkets(ids, cs);

        HexitGame g = HexitGame(address(new ERC1967Proxy(address(new HexitGame()), abi.encodeCall(HexitGame.initialize, (owner, address(usdc), ROW, _params())))));
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); g.initializeMarkets(ids, cs);
        vm.prank(owner); vm.expectRevert(HexitGame.BadParams.selector); g.initializeMarkets(ids, new HexitGame.MarketConfig[](0));
        cs[0].rowE8 = 0;
        vm.prank(owner); vm.expectRevert(HexitGame.BadParams.selector); g.initializeMarkets(ids, cs);
        cs[0].rowE8 = MON_ROW;
        vm.expectEmit(address(g)); emit HexitGame.MarketSet(0, ROW, 25_000_000, 100_000_000_000, false);
        vm.expectEmit(address(g)); emit HexitGame.MarketSet(MON, MON_ROW, 10_000, 100_000_000_000, true);
        vm.prank(owner); g.initializeMarkets(ids, cs);
        (int64 row,,,,) = g.markets(MON);
        assertEq(row, MON_ROW);
    }

    function test_setMarket() public {
        HexitGame.MarketConfig memory c = _cfg(MON_ROW);
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); game.setMarket(MON, c);
        c.rowE8 = 0;
        vm.prank(owner); vm.expectRevert(HexitGame.BadParams.selector); game.setMarket(MON, c);
        c.rowE8 = -1;
        vm.prank(owner); vm.expectRevert(HexitGame.BadParams.selector); game.setMarket(MON, c);
        c.rowE8 = 1;                                                               // the smallest row passes
        _setM(MON, c);
        vm.expectEmit(address(game)); emit HexitGame.MarketSet(MON, MON_ROW, 10_000, 100_000_000_000, true);
        _setM(MON, _cfg(MON_ROW));
        assertEq(abi.encode(_market(MON)), abi.encode(HexitGame.Market(MON_ROW, 10_000, true, 100_000_000_000, 0)));
    }

    /// The row is frozen while the market has open bets (their columns keep the band index set from the old row);
    /// everything else can change at once. Once the bets close, the row can change.
    function test_setMarket_MarketBusy() public {
        _grant(alice.addr);
        uint32 k = _openK();
        _bet(alice, k, _flatBand(k, PRICE), 1e6, 0);
        HexitGame.MarketConfig memory c = HexitGame.MarketConfig(ROW, 1, 7e6, false);
        _setM(A, c);                                                               // same row: tunes the rest
        assertEq(abi.encode(_market(A)), abi.encode(HexitGame.Market(ROW, 1, false, 7e6, 2e6)));
        c.rowE8 = ROW + 1;
        vm.prank(owner); vm.expectRevert(HexitGame.MarketBusy.selector); game.setMarket(A, c);
        _setM(A, _cfg(ROW));
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _one(alice.addr));
        _setM(A, c);                                                               // no open bets: the row may change
        assertEq(_market(A).rowE8, ROW + 1);
    }

    function test_asset_ids_stop_at_7() public {
        _grant(alice.addr);
        vm.prank(owner); vm.expectRevert(stdError.indexOOBError); game.setMarket(8, _cfg(ROW));
        uint32 k = _openK();
        HexitGame.Bet memory b = HexitGame.Bet(alice.addr, 8, k, 2400, 1e6, 101, 0, uint64(block.timestamp + 10));
        (HexitGame.Quote memory q, uint16[64] memory m) = _quote(8, ROW, k, PRICE, 200);
        bytes memory s = _sign(alice.privateKey, _betHash(b));
        bytes memory qs = _sign(quoter.privateKey, _quoteHash(q, m));
        vm.prank(relayer); vm.expectRevert(stdError.indexOOBError); game.placeBetFor(b, s, q, m, qs);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        bytes memory sig = _tapeSigOn(recorder.privateKey, 8, k, ts, px);
        vm.expectRevert(stdError.indexOOBError); game.settleColumn(8, k, ts, px, sig, _one(alice.addr));
        vm.warp(uint256(HexGeo.tHi(k) + 120_000) / 1000 + 1);
        vm.expectRevert(stdError.indexOOBError); game.voidColumn(8, k, _one(alice.addr));
    }

    // ================================================================== bets
    /// SOL (0) is closed by initializeMarkets, ETH (2) was never listed, and a closed market still settles its open bets.
    function test_bet_MarketClosed() public {
        _grant(alice.addr);
        uint32 k = _openK();
        _betOn(alice, 0, ROW, PRICE, k, 2400, 1e6, 0, HexitGame.MarketClosed.selector);
        _betOn(alice, 2, ROW, PRICE, k, 2400, 1e6, 0, HexitGame.MarketClosed.selector);
        _bet(alice, k, _flatBand(k, PRICE), 1e6, 0);
        HexitGame.MarketConfig memory c = _cfg(ROW);
        c.enabled = false;
        _setM(A, c);
        _betOn(alice, A, ROW, PRICE, k, 2400, 1e6, 1, HexitGame.MarketClosed.selector);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 101e6);                                      // WIN paid on a closed market
        _setM(A, _cfg(ROW));
        _betOn(alice, A, ROW, PRICE, _openK(), 2400, 1e6, 1, 0);
        _assertTreasury();
    }

    /// Per-market cap: Σ payout of a market's open bets <= maxLiab (boundary passes, +1 bet fails); the other market
    /// is unaffected, and the cap counts only bets that are still open.
    function test_bet_AssetCap() public {
        HexitGame.MarketConfig memory c = _cfg(ROW);
        c.maxLiab = 5e6;
        _setM(A, c);
        _setM(MON, _cfg(ROW));
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);
        _bet(alice, k + 1, 2400, 1e6, 1);
        _bet(alice, k + 2, 2400, 500_000, 2);                                      // 5e6 = cap
        _betOn(alice, A, ROW, PRICE, k + 3, 2400, 100_000, 3, HexitGame.AssetCap.selector);
        _betOn(alice, MON, ROW, PRICE, k + 3, 2400, 100_000, 3, 0);                // another market has room
        assertEq(_market(A).openLiab, 5e6);
        assertEq(_market(MON).openLiab, 200_000);
        assertEq(game.openLiability(), 5_200_000);
        vm.warp(uint256(HexGeo.tHi(k) + 120_000) / 1000 + 1);
        game.voidColumn(A, k, _one(alice.addr));                                   // frees 2e6 of A's cap
        _betOn(alice, A, ROW, PRICE, _openK(), 2400, 1e6, 4, 0);
        _assertTreasury();
    }

    function _ready() internal returns (uint32 k) { _grant(alice.addr); k = _openK(); }

    // ================================================================== two live markets
    /// BTC and MON at their own rows on the same k: one credit balance pays for both; each column has its own bJ0,
    /// liability and decision; settling one market leaves the other open; liabilities are booked per market.
    function test_two_markets_one_credit() public {
        _bothListed();
        uint32 k = _openK();
        int32 jb = _flatBand(k, BTC_PX, BTC_ROW);
        int32 jm = _flatBand(k, MON_PX, MON_ROW);
        vm.expectEmit(address(game)); emit HexitGame.BetPlaced(alice.addr, BTC, k, jb, 5e6, 200, 0, 0);
        _betOn(alice, BTC, BTC_ROW, BTC_PX, k, jb, 5e6, 0, 0);                    // WIN
        _betOn(alice, MON, MON_ROW, MON_PX, k, jm + 3, 3e6, 1, 0);                // LOSS
        _betOn(alice, MON, MON_ROW, MON_PX, k, jm, 2e6, 2, 0);                    // WIN
        assertEq(_credit(alice.addr), 90e6);
        (int32 bJ0b, uint8 sb,, uint64 lb,) = game.columnOf(BTC, k);
        (int32 bJ0m, uint8 sm,, uint64 lm,) = game.columnOf(MON, k);
        assertEq(bJ0b, int32(int256(uint256(BTC_PX) / uint64(BTC_ROW))) - 128);
        assertEq(bJ0m, int32(int256(uint256(MON_PX) / uint64(MON_ROW))) - 128);
        assertEq(abi.encode(sb, sm, lb, lm), abi.encode(uint8(1), uint8(1), uint64(10e6), uint64(10e6)));
        (, uint8 s2,,,) = game.columnOf(2, k);                                    // no other market's column moved
        assertEq(s2, 0);
        assertEq(_market(BTC).openLiab, 10e6);
        assertEq(_market(MON).openLiab, 10e6);
        assertEq(game.openLiability(), 20e6);

        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, MON_PX);
        vm.expectEmit(true, true, true, false, address(game)); emit HexitGame.HexTouched(MON, k, jm, 0);
        vm.expectEmit(address(game)); emit HexitGame.ColumnSettled(MON, k, bJ0m, false, uint256(1) << uint256(int256(jm - bJ0m)));
        vm.expectEmit(address(game)); emit HexitGame.BetSettled(alice.addr, MON, k, jm + 3, 3e6, 200, 1, 2, 0);
        vm.expectEmit(address(game)); emit HexitGame.BetSettled(alice.addr, MON, k, jm, 2e6, 200, 2, 1, 4e6);
        _settleOn(MON, k, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 94e6);
        assertEq(_openMask(alice.addr), 1);                                        // the BTC bet is still open
        (, sb,,,) = game.columnOf(BTC, k);
        assertEq(sb, 1);
        assertEq(_market(MON).openLiab, 0);
        assertEq(_market(BTC).openLiab, 10e6);
        assertEq(game.openLiability(), 10e6);

        (ts, px) = _flatTape(k, BTC_PX);
        _settleOn(BTC, k, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 104e6);
        assertEq(game.openLiability(), 0);
        assertEq(game.house(), HOUSE - 5e6 - 2e6 + 3e6);
        assertEq(game.netLossToday(), 4e6);                                        // one daily count for all markets
        _assertTreasury();
    }

    /// A void refunds only its own market's column; the same k on the other market is untouched.
    function test_void_one_market() public {
        _bothListed();
        uint32 k = _openK();
        _betOn(alice, BTC, BTC_ROW, BTC_PX, k, _flatBand(k, BTC_PX, BTC_ROW), 5e6, 0, 0);
        _betOn(alice, MON, MON_ROW, MON_PX, k, _flatBand(k, MON_PX, MON_ROW), 2e6, 1, 0);
        vm.warp(uint256(HexGeo.tHi(k) + 120_000) / 1000 + 1);
        vm.expectEmit(address(game)); emit HexitGame.ColumnVoided(MON, k);
        game.voidColumn(MON, k, _one(alice.addr));
        assertEq(_credit(alice.addr), 95e6);
        assertEq(_openMask(alice.addr), 1);
        (, uint8 sb,,,) = game.columnOf(BTC, k);
        assertEq(sb, 1);
        game.voidColumn(BTC, k, _one(alice.addr));
        assertEq(_credit(alice.addr), 100e6);
        assertEq(game.openLiability(), 0);
        _assertTreasury();
    }

    // ================================================================== the asset in every signature
    function test_asset_is_signed() public {
        _bothListed();
        uint32 k = _openK();
        int32 jm = _flatBand(k, MON_PX, MON_ROW);
        // a bet signed for BTC cannot be relayed as a MON bet
        HexitGame.Bet memory b = HexitGame.Bet(alice.addr, BTC, k, jm, 1e6, 101, 0, uint64(block.timestamp + 10));
        bytes memory s = _sign(alice.privateKey, _betHash(b));
        (HexitGame.Quote memory q, uint16[64] memory m) = _quote(MON, MON_ROW, k, MON_PX, 200);
        bytes memory qs = _sign(quoter.privateKey, _quoteHash(q, m));
        b.asset = MON;
        vm.prank(relayer); vm.expectRevert(HexitGame.BadSig.selector); game.placeBetFor(b, s, q, m, qs);
        // a valid MON quote does not price a BTC bet
        b.asset = BTC;
        vm.prank(relayer); vm.expectRevert(HexitGame.NotQuoted.selector); game.placeBetFor(b, s, q, m, qs);
        // the quote's asset cannot be edited after signing
        q.asset = BTC;
        vm.prank(relayer); vm.expectRevert(HexitGame.NotQuoter.selector); game.placeBetFor(b, s, q, m, qs);

        _betOn(alice, MON, MON_ROW, MON_PX, k, jm, 1e6, 0, 0);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, MON_PX);
        // a tape signed for (BTC, k) or in the pre-markets format does not settle (MON, k)
        bytes memory sig = _tapeSigOn(recorder.privateKey, BTC, k, ts, px);
        vm.expectRevert(HexitGame.NotRecorder.selector); game.settleColumn(MON, k, ts, px, sig, _one(alice.addr));
        sig = _sign(recorder.privateKey, keccak256(abi.encode(keccak256("ColumnTape(uint32 k,bytes32 ticksHash)"), k, _ticksHash(ts, px))));
        vm.expectRevert(HexitGame.NotRecorder.selector); game.settleColumn(MON, k, ts, px, sig, _one(alice.addr));
        _settleOn(MON, k, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 101e6);
    }

    /// q.asset == b.asset on its own (security review L3): both markets at the same row and price, so a MON quote fits the
    /// BTC column's band window and row, and only the asset check refuses it. The same quote for BTC passes.
    function test_quote_asset_is_checked() public {
        _grant(alice.addr);
        _setM(MON, _cfg(ROW));
        uint32 k = _openK();
        (HexitGame.Quote memory q, uint16[64] memory m) = _quote(MON, ROW, k, PRICE, 200);
        HexitGame.Bet memory b = HexitGame.Bet(alice.addr, A, k, 2400, 1e6, 101, 0, uint64(block.timestamp + 10));
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NotQuoted.selector);
        q.asset = A;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    /// A quote binds the band height it was priced at (security review M1). With no open bets the owner may change the
    /// row while the market stays open; a quote signed before that must not price a bet after it: at a row 1.26 % smaller
    /// its band qJ0 + 63 (31 bands over the price, quoted 100x) is the band the price sits in. A quote at the new row passes.
    function test_quote_row_is_bound() public {
        _grant(alice.addr);
        uint32 k = _openK();
        if (k % 2 == 1) k += 1;
        (HexitGame.Quote memory q, uint16[64] memory m) = _quote(A, ROW, k, PRICE, 200);
        m[63] = 10000;
        int64 newRow = 4_937_000;
        _setM(A, _cfg(newRow));
        HexitGame.Bet memory b = HexitGame.Bet(alice.addr, A, k, q.qJ0 + 63, 25e6, 101, 0, uint64(block.timestamp + 10));
        assertEq(_flatBand(k, PRICE, newRow), b.j);                               // the 100x band is at the money now
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.QuoteStale.selector);
        q.rowE8 = ROW + 1;                                                         // any row but the market's
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.QuoteStale.selector);
        (q, m) = _quote(A, newRow, k, PRICE, 200);                                 // the quoter's next board, at the new row
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        assertEq(_credit(alice.addr), 75e6);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 125e6);                                      // 2x, not 100x
    }

    /// Each market checks tapes against its own maxMoveE8 (a BTC-sized step is far over MON's limit).
    function test_settle_MoveTooLarge_per_market() public {
        _bothListed();
        uint32 k = _openK();
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, MON_PX);
        for (uint256 i = 10; i < px.length; ++i) px[i] = MON_PX + 10_001;          // MON limit 10,000 per 100 ms
        bytes memory sig = _tapeSigOn(recorder.privateKey, MON, k, ts, px);
        vm.expectRevert(HexitGame.MoveTooLarge.selector); game.settleColumn(MON, k, ts, px, sig, new address[](0));
        for (uint256 i = 10; i < px.length; ++i) px[i] = MON_PX + 10_000;
        _settleOn(MON, k, ts, px, new address[](0));
        (ts, px) = _flatTape(k, BTC_PX);
        for (uint256 i = 10; i < px.length; ++i) px[i] = BTC_PX + 12_500_000_000;  // exactly BTC's limit
        _settleOn(BTC, k, ts, px, new address[](0));
    }
}
