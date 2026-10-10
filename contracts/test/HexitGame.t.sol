// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {HexGeo} from "../src/HexGeo.sol";
import {Base} from "./Base.t.sol";

/// One test per function path and per custom error (each guard has a failing case and, where it has a boundary,
/// the passing value next to it).
contract HexitGameTest is Base {
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141; // secp256k1 order

    function _notOwner(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, who);
    }

    function _setP(HexitGame.Params memory p) internal { vm.prank(owner); game.setParams(p); }

    function _ready() internal returns (uint32 k) { _grant(alice.addr); k = _openK(); }

    // ================================================================== config
    function test_typehashes_match_readme() public view {
        assertEq(game.BET_TYPEHASH(), keccak256(bytes(BET_T)));
        assertEq(game.QUOTE_TYPEHASH(), keccak256(bytes(QUOTE_T)));
        assertEq(game.TAPE_TYPEHASH(), keccak256(bytes(TAPE_T)));
        assertEq(game.WITHDRAW_TYPEHASH(), keccak256(bytes(WITHDRAW_T)));
        assertEq(game.DEPOSIT_TYPEHASH(), keccak256(bytes(DEPOSIT_T)));
        assertEq(game.domainSeparator(), dom);
    }

    /// Known-answer vectors from viem 2.57.4 hashTypedData (README "EIP-712 test vectors"): the Solidity-side encoding
    /// the contract uses must give the same digests, including multsHash and ticksHash packing, int32 sign extension
    /// the uint8 asset (3 = MON) and the quote's int64 rowE8.
    function test_eip712_vectors_match_viem() public pure {
        bytes32 d = _domain(10143, address(0xaa));
        uint16[64] memory m;
        for (uint256 i; i < 64; ++i) m[i] = uint16(150 + 10 * (i % 32));
        assertEq(keccak256(abi.encodePacked(m)), 0xa4d69d8a1e217af491f513e94e73c7175c058e97d6b2262c193ea798c5dc3f6c);
        HexitGame.Quote memory q = HexitGame.Quote(3, 2000, 358000002, -5, 1790000003000, 12002250000, 1790000004500);
        assertEq(keccak256(abi.encodePacked("\x19\x01", d, _quoteHash(q, m))), 0x18924f36958f3ea4139f035437e8c8ca512d9220bbce1c8bfa5afffae2d628e6);
        HexitGame.Bet memory b = HexitGame.Bet(address(0xbb), 3, 358000002, -7, 1000000, 101, 3, 1790000010);
        assertEq(keccak256(abi.encodePacked("\x19\x01", d, _betHash(b))), 0x779f6fb72275e794ea542c432eadc29a97ba02278f4937a9a8e9cbfcb45afa87);
        uint64[] memory ts = new uint64[](3);
        uint64[] memory px = new uint64[](3);
        (ts[0], ts[1], ts[2]) = (1790000009100, 1790000009200, 1790000009300);
        (px[0], px[1], px[2]) = (12002250000, 12002350000, 12002150000);
        bytes32 th = _ticksHash(ts, px);
        assertEq(th, 0xe640a17873080e8f02b1c91295921b89cad701afdf7fec245c91bc05cb40b962);
        assertEq(keccak256(abi.encodePacked("\x19\x01", d, keccak256(abi.encode(keccak256(bytes(TAPE_T)), uint8(3), uint32(358000002), th)))),
            0xa0404638e9aeb3199199acb8d1c0771a54c816a4972386dfe2246c8a9e41def2);
    }

    function test_initialize_state() public view {
        assertEq(game.owner(), owner);
        assertEq(game.usdc(), address(usdc));
        assertEq(game.rowE8(), ROW);
        assertEq(abi.encode(game.getParams()), abi.encode(_params()));
        assertEq(game.house(), HOUSE);
        assertEq(game.day(), T0 / 86400);
        _assertTreasury();
    }

    function test_initialize_BadParams() public {
        address impl = address(new HexitGame());
        vm.expectRevert(HexitGame.BadParams.selector);
        new ERC1967Proxy(impl, abi.encodeCall(HexitGame.initialize, (owner, address(0), ROW, _params())));
        vm.expectRevert(HexitGame.BadParams.selector);
        new ERC1967Proxy(impl, abi.encodeCall(HexitGame.initialize, (owner, address(usdc), 0, _params())));
        HexitGame.Params memory p = _params();
        p.gapMs = 99;
        vm.expectRevert(HexitGame.BadParams.selector);
        new ERC1967Proxy(impl, abi.encodeCall(HexitGame.initialize, (owner, address(usdc), ROW, p)));
    }

    function test_setParams() public {
        HexitGame.Params memory p = _params();
        p.maxOpen = 33;
        vm.prank(owner); vm.expectRevert(HexitGame.BadParams.selector); game.setParams(p);
        p = _params(); p.minStake = 0;
        vm.prank(owner); vm.expectRevert(HexitGame.BadParams.selector); game.setParams(p);
        p = _params(); p.minStake = p.maxStake + 1;
        vm.prank(owner); vm.expectRevert(HexitGame.BadParams.selector); game.setParams(p);
        p = _params(); p.maxPayout = uint64(p.maxHexLiab) + 1;
        vm.prank(owner); vm.expectRevert(HexitGame.BadParams.selector); game.setParams(p);
        p = _params(); p.gapMs = 99;
        vm.prank(owner); vm.expectRevert(HexitGame.BadParams.selector); game.setParams(p);

        p = _params(); p.quoter = bob.addr; p.maxOpen = 32; p.minStake = p.maxStake; p.maxPayout = p.maxHexLiab; p.gapMs = 100;
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); game.setParams(p);
        vm.expectEmit(address(game)); emit HexitGame.ParamsSet(owner);
        _setP(p);
        assertEq(abi.encode(game.getParams()), abi.encode(p));
    }

    function test_setPause() public {
        vm.expectEmit(address(game)); emit HexitGame.Paused(guardian, 2);
        vm.prank(guardian); game.setPause(2, true);
        assertEq(game.paused(), 2);
        vm.prank(guardian); vm.expectRevert(HexitGame.NotGuardian.selector); game.setPause(2, false);
        vm.prank(alice.addr); vm.expectRevert(HexitGame.NotGuardian.selector); game.setPause(1, true);
        vm.prank(owner); game.setPause(1, true);
        assertEq(game.paused(), 3);
        vm.prank(owner); game.setPause(3, false);
        assertEq(game.paused(), 0);
    }

    /// L4: the guardian's recorder kill switch. A disabled recorder's tapes are refused (the column can still VOID); the
    /// other slots keep working; the guardian cannot re-enable; the owner can.
    function test_setDisabled_blocks_recorder() public {
        Vm.Wallet memory r2 = vm.createWallet("recorder2");
        HexitGame.Params memory p = _params();
        p.recorders[1] = r2.addr;
        _setP(p);
        uint32 k = _ready();
        _bet(alice, k, _flatBand(k, PRICE), 1e6, 0);
        _bet(alice, k + 1, _flatBand(k + 1, PRICE), 1e6, 1);
        vm.prank(alice.addr); vm.expectRevert(HexitGame.NotGuardian.selector); game.setDisabled(1, true);
        vm.expectEmit(address(game)); emit HexitGame.Disabled(guardian, 1);
        vm.prank(guardian); game.setDisabled(1, true);
        assertEq(game.disabled(), 1);
        vm.prank(guardian); vm.expectRevert(HexitGame.NotGuardian.selector); game.setDisabled(1, false);
        _afterSpan(k + 1);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        vm.expectRevert(HexitGame.NotRecorder.selector); _settle(k, ts, px, _one(alice.addr));     // recorders[0] is off
        game.settleColumn(A, k, ts, px, _tapeSig(r2.privateKey, k, ts, px), _one(alice.addr));         // recorders[1] still on
        (ts, px) = _flatTape(k + 1, PRICE);
        vm.prank(owner); game.setDisabled(1, false);
        assertEq(game.disabled(), 0);
        _settle(k + 1, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 100e6 + 2e6);
        _assertTreasury();
    }

    // ================================================================== grant
    function test_grant() public {
        vm.expectEmit(address(game)); emit HexitGame.Granted(alice.addr, 100e6);
        _grant(alice.addr);
        (uint64 credit,,,,, bool granted, uint256[16] memory bets) = game.playerOf(alice.addr);
        assertEq(credit, 100e6);
        assertTrue(granted);
        for (uint256 i; i < 16; ++i) assertEq(bets[i], 1, "bet words pre-filled");
        assertEq(game.totalCredit(), 100e6);
        vm.prank(owner); game.grant(bob.addr);                                     // owner may grant too
        assertEq(_credit(bob.addr), 100e6);
        _assertTreasury();
    }

    function test_grant_AlreadyGranted() public {
        _grant(alice.addr);
        vm.expectRevert(HexitGame.AlreadyGranted.selector);
        vm.prank(relayer); game.grant(alice.addr);
    }

    function test_grant_NotRelayer() public {
        vm.expectRevert(HexitGame.NotRelayer.selector);
        vm.prank(alice.addr); game.grant(alice.addr);
    }

    // ================================================================== bets: happy paths
    function test_placeBetFor() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2401, 5e6, 0);
        vm.expectEmit(address(game)); emit HexitGame.BetPlaced(alice.addr, A, k, 2401, 5e6, 200, 0, 0);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        (uint64 credit, uint64 openStake, uint48 nb, uint32 nm, uint32 om,, uint256[16] memory bets) = game.playerOf(alice.addr);
        assertEq(credit, 95e6);
        assertEq(openStake, 5e6);
        assertEq(nb, 1);
        assertEq(nm, 0);
        assertEq(om, 1);
        assertEq(bets[0] & type(uint128).max, uint256(k) | uint256(uint32(int32(2401))) << 32 | uint256(5e6) << 64 | uint256(200) << 96 | uint256(A) << 112);
        (int32 bJ0, uint8 state,, uint64 totalLiab,) = game.columnOf(A, k);
        assertEq(bJ0, 2400 - 128);
        assertEq(state, 1);
        assertEq(totalLiab, 10e6);
        assertEq(game.openLiability(), 10e6);
        assertEq(game.houseLiab(), 5e6);
        assertEq(game.totalOpen(), 5e6);
        assertEq(game.totalCredit(), 95e6);
        _assertTreasury();
    }

    function test_placeBet_direct() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        bytes memory qs = _sign(quoter.privateKey, _quoteHash(q, m));
        vm.prank(bob.addr); vm.expectRevert(HexitGame.BadSig.selector); game.placeBet(b, q, m, qs);
        vm.prank(alice.addr); game.placeBet(b, q, m, qs);
        assertEq(_credit(alice.addr), 99e6);
        vm.prank(guardian); game.setPause(2, true);
        b.nonce = 1;
        vm.prank(alice.addr); vm.expectRevert(HexitGame.IsPaused.selector); game.placeBet(b, q, m, qs);
    }

    // ================================================================== bets: every guard
    function test_bet_NotRelayer() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        bytes memory s = _sign(alice.privateKey, _betHash(b));
        bytes memory qs = _sign(quoter.privateKey, _quoteHash(q, m));
        vm.prank(alice.addr); vm.expectRevert(HexitGame.NotRelayer.selector); game.placeBetFor(b, s, q, m, qs);
    }

    function test_bet_IsPaused() public {
        uint32 k = _ready();
        vm.prank(guardian); game.setPause(2, true);
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.IsPaused.selector);
        vm.prank(guardian); game.setPause(1, true);                                // deposit pause alone does not block play
        vm.prank(owner); game.setPause(2, false);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    function test_bet_BadSig() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        _submit(b, bob.privateKey, q, m, quoter.privateKey, HexitGame.BadSig.selector);   // signed by someone else
        bytes memory qs = _sign(quoter.privateKey, _quoteHash(q, m));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(alice.privateKey, keccak256(abi.encodePacked("\x19\x01", dom, _betHash(b))));
        bytes memory s = abi.encodePacked(r, ss, v);
        bytes memory high = abi.encodePacked(r, bytes32(N - uint256(ss)), v == 27 ? uint8(28) : uint8(27));
        vm.prank(relayer); vm.expectRevert(HexitGame.BadSig.selector); game.placeBetFor(b, high, q, m, qs);   // malleable (high s)
        bytes memory short = abi.encodePacked(r, ss);
        vm.prank(relayer); vm.expectRevert(HexitGame.BadSig.selector); game.placeBetFor(b, short, q, m, qs);  // 64 bytes
        b.stake = 2e6;                                                             // signed fields can't be changed
        vm.prank(relayer); vm.expectRevert(HexitGame.BadSig.selector); game.placeBetFor(b, s, q, m, qs);
    }

    function test_bet_Expired() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        b.deadline = uint64(block.timestamp - 1);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.Expired.selector);
        b.deadline = uint64(block.timestamp);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    function test_bet_NonceUsed() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NonceUsed.selector);    // replay
        b.nonce = 33;                                                                           // window is [1, 33)
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NonceUsed.selector);
        b.nonce = 32;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    /// T-NONCE: unordered inside the window, shared with Withdraw, a gap holds the window, an expired unused
    /// nonce can be signed again.
    function test_nonce_window() public {
        _grant(alice.addr);
        uint64 dl = uint64(block.timestamp + 10);
        _withdrawFor(alice, 1, 31, dl, 0);
        _withdrawFor(alice, 1, 32, dl, HexitGame.NonceUsed.selector);              // beyond [0, 32)
        for (uint64 n = 30; n >= 1; --n) _withdrawFor(alice, 1, n, dl, 0);       // any order
        (,, uint48 base, uint32 mask,,,) = game.playerOf(alice.addr);
        assertEq(base, 0);
        assertEq(mask, 0xFFFFFFFE);                                               // nonce 0 unused holds the window
        // nonce 0 signed as a bet that expires unsent, then re-signed: lands, window slides to 32
        uint32 k = _openK();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        b.deadline = uint64(block.timestamp - 1);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.Expired.selector);
        b.deadline = uint64(block.timestamp + 10);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        (,, base, mask,,,) = game.playerOf(alice.addr);
        assertEq(base, 32);
        assertEq(mask, 0);
        _withdrawFor(alice, 1, 32, dl, 0);
    }

    function test_bet_StakeOutOfRange() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 99_999, 0);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.StakeOutOfRange.selector);
        b.stake = 50_000_001;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.StakeOutOfRange.selector);
        b.stake = 100_000;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        b.stake = 50_000_000;
        b.nonce = 1;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    function test_bet_NotQuoter() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        _submit(b, alice.privateKey, q, m, alice.privateKey, HexitGame.NotQuoter.selector);    // not the quoter's key
        // mults changed after the quoter signed
        bytes memory s = _sign(alice.privateKey, _betHash(b));
        bytes memory qs = _sign(quoter.privateKey, _quoteHash(q, m));
        m[32] = 9000;
        vm.prank(relayer); vm.expectRevert(HexitGame.NotQuoter.selector); game.placeBetFor(b, s, q, m, qs);
        m[32] = 200;
        q.refPriceE8 += 1;                                                         // quote field changed
        vm.prank(relayer); vm.expectRevert(HexitGame.NotQuoter.selector); game.placeBetFor(b, s, q, m, qs);
    }

    function test_bet_QuoteStale() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        uint64 nowMs = uint64(_nowMs());
        q.refTsMs = nowMs - 1501;                                                  // older than quoteMaxAgeMs
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.QuoteStale.selector);
        q.refTsMs = nowMs + 1001;                                                  // more than 1 s ahead of block time
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.QuoteStale.selector);
        q.refTsMs = nowMs;
        q.expiresMs = nowMs - 1;                                                   // expired
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.QuoteStale.selector);
        q.expiresMs = nowMs;
        q.refTsMs = nowMs - 1500;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        q.refTsMs = nowMs + 1000;
        b.nonce = 1;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    function test_bet_NotQuoted() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        q.k = k + 1;                                                               // quote for another column
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NotQuoted.selector);
        q.k = k;
        b.j = q.qJ0 - 1;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NotQuoted.selector);
        b.j = q.qJ0 + 64;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NotQuoted.selector);
        b.j = q.qJ0 + 63;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        b.j = q.qJ0;
        b.nonce = 1;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    /// Bets must fall inside the column's 256-band window [bJ0, bJ0 + 255], bJ0 = first bet's ref band - 128.
    function test_bet_NotQuoted_window() public {
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);                                              // bJ0 = 2272
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2272 + 256, 1e6, 1);
        q.refPriceE8 = uint64(2520 * uint256(uint64(ROW)));                        // qJ0 = 2488: covers 2488..2551
        q.qJ0 = 2488;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NotQuoted.selector);
        b.j = 2272 + 255;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        q.refPriceE8 = uint64(2280 * uint256(uint64(ROW)));
        q.qJ0 = 2248;
        b.j = 2271;
        b.nonce = 2;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NotQuoted.selector);
        b.j = 2272;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    function test_bet_NotOffered() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        uint256 i = uint256(int256(b.j) - q.qJ0);
        m[i] = 0;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NotOffered.selector);
        m[i] = 100;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NotOffered.selector);
        m[i] = 10001;                                                              // MAX_MULT: at most 100x
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.NotOffered.selector);
        m[i] = 10000;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        m[i] = 101;
        b.nonce = 1;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    function test_bet_BelowMinMult() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        b.minMult = 201;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.BelowMinMult.selector);
        b.minMult = 200;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    /// T-LOCK: tLo(k) - max(refTs, now) = 6,100 passes, 6,099 is Locked.
    function test_bet_Locked() public {
        _grant(alice.addr);
        uint32 k = _openK();
        uint256 ref = uint256(HexGeo.tLo(k)) - 6100;
        vm.warp(ref / 1000);                                                       // block time <= ref < block time + 1 s
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        q.refTsMs = uint64(ref + 1);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.Locked.selector);
        q.refTsMs = uint64(ref);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        // without a later ref, block time decides: next whole second makes k too close
        vm.warp(ref / 1000 + 1);
        (b, q, m) = _pieces(alice, k, 2400, 1e6, 1);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.Locked.selector);
    }

    function test_bet_PayoutCap() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 50e6, 0);
        m = _mults(5001);                                                          // 50e6 x 50.01 = 2,500,500,000
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.PayoutCap.selector);
        m = _mults(5000);                                                          // exactly maxPayout
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    function test_bet_HexCap() public {
        HexitGame.Params memory p = _params();
        p.maxHexLiab = 3e6;
        p.maxPayout = 3e6;
        _setP(p);
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);                                              // payout 2e6
        _bet(alice, k, 2400, 500_000, 1);                                          // 3e6 = cap
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 100_000, 2);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.HexCap.selector);
        b.j = 2401;                                                                // another hex has room
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    function test_bet_ColumnCap() public {
        HexitGame.Params memory p = _params();
        p.maxColLiab = 5e6;
        _setP(p);
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);
        _bet(alice, k, 2401, 1e6, 1);
        _bet(alice, k, 2402, 500_000, 2);                                          // 5e6 = cap
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2403, 100_000, 3);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.ColumnCap.selector);
        (b, q, m) = _pieces(alice, k + 1, 2403, 100_000, 3);                       // the next column has room
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
    }

    function test_bet_MarketCap() public {
        HexitGame.Params memory p = _params();
        p.maxMarketLiab = 5e6;
        _setP(p);
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);
        _bet(alice, k + 1, 2400, 1e6, 1);
        _bet(alice, k + 2, 2400, 500_000, 2);                                      // 5e6 = cap across columns
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k + 3, 2400, 100_000, 3);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.MarketCap.selector);
    }

    /// T-SOLV: houseLiab + (payout - stake) = house passes, +1 fails.
    function test_bet_HouseCapacity() public {
        vm.prank(owner); game.houseWithdraw(HOUSE - 2e6);                          // house = 2e6
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);                                              // houseLiab 1e6
        _bet(alice, k, 2401, 1e6, 1);                                              // houseLiab 2e6 = house
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2402, 100_000, 2);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.HouseCapacity.selector);
        m = _mults(101);                                                           // 100,000 x 1.01 => +1,000: still over
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.HouseCapacity.selector);
        _assertTreasury();
    }

    function test_bet_InsufficientCredit() public {
        uint32 k = _ready();
        _bet(alice, k, 2400, 50e6, 0);
        _bet(alice, k, 2401, 49_900_000, 1);                                       // credit 100,000 left
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2402, 100_001, 2);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.InsufficientCredit.selector);
        b.stake = 100_000;
        _submit(b, alice.privateKey, q, m, quoter.privateKey, 0);
        assertEq(_credit(alice.addr), 0);
    }

    function test_bet_TooManyOpen() public {
        uint32 k = _ready();
        for (uint64 n; n < 32; ++n) _bet(alice, k, 2400, 100_000, n);
        assertEq(_openMask(alice.addr), type(uint32).max);
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 100_000, 32);
        _submit(b, alice.privateKey, q, m, quoter.privateKey, HexitGame.TooManyOpen.selector);
        HexitGame.Params memory p = _params();
        p.maxOpen = 2;
        _setP(p);
        _grant(bob.addr);
        _bet(bob, k, 2400, 100_000, 0);
        _bet(bob, k, 2400, 100_000, 1);
        (b, q, m) = _pieces(bob, k, 2400, 100_000, 2);
        _submit(b, bob.privateKey, q, m, quoter.privateKey, HexitGame.TooManyOpen.selector);
    }

    /// T-DAILY: a win that reaches dailyLossLimit halts new bets until the next UTC day.
    function test_bet_DailyLossHalt() public {
        HexitGame.Params memory p = _params();
        p.dailyLossLimit = 1e6;
        _setP(p);
        uint32 k = _ready();
        _grant(bob.addr);
        _bet(alice, k, _flatBand(k, PRICE), 1e6, 0);                               // wins 1e6 net
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _one(alice.addr));
        assertEq(game.netLossToday(), 1e6);
        uint32 k2 = _openK();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(bob, k2, 2400, 100_000, 0);
        _submit(b, bob.privateKey, q, m, quoter.privateKey, HexitGame.DailyLossHalt.selector);
        vm.warp((block.timestamp / 86400 + 1) * 86400);
        (b, q, m) = _pieces(bob, _openK(), 2400, 100_000, 0);
        _submit(b, bob.privateKey, q, m, quoter.privateKey, 0);
        assertEq(game.netLossToday(), 0);
    }

    /// T-DAILY: a settle on a new UTC day, before that day's first bet, starts the day's count at zero.
    function test_settle_rolls_day() public {
        uint32 k = _ready();
        _bet(alice, k, _flatBand(k, PRICE) + 3, 1e6, 0);                           // LOSS today
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _one(alice.addr));
        assertEq(game.netLossToday(), -1e6);
        uint256 midnight = (block.timestamp / 86400 + 1) * 86400;
        vm.warp(midnight - 10);
        uint32 k2 = _openK();
        assertGt(HexGeo.tHi(k2), int256(midnight * 1000));                         // its span ends tomorrow
        _bet(alice, k2, _flatBand(k2, PRICE), 2e6, 1);                             // WIN 2x, settled tomorrow
        _afterSpan(k2);
        (ts, px) = _flatTape(k2, PRICE);
        _settle(k2, ts, px, _one(alice.addr));
        assertEq(game.day(), midnight / 86400);
        assertEq(game.netLossToday(), 2e6);                                         // not 2e6 - 1e6
    }

    // ================================================================== settlement
    function test_settle_win_loss_exact() public {
        uint32 k = _ready();
        _grant(bob.addr);
        int32 jw = _flatBand(k, PRICE);
        _bet(alice, k, jw, 5e6, 0);                                                // WIN 2x
        _bet(alice, k, jw + 3, 2e6, 1);                                            // LOSS
        _bet(bob, k, jw - 3, 1e6, 0);                                              // LOSS
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        vm.expectEmit(address(game)); emit HexitGame.ColumnSettled(A, k, 2272, false, uint256(1) << uint256(int256(jw) - 2272));
        vm.expectEmit(address(game)); emit HexitGame.BetSettled(alice.addr, A, k, jw, 5e6, 200, 0, 1, 10e6);
        vm.expectEmit(address(game)); emit HexitGame.BetSettled(alice.addr, A, k, jw + 3, 2e6, 200, 1, 2, 0);
        vm.expectEmit(address(game)); emit HexitGame.BetSettled(bob.addr, A, k, jw - 3, 1e6, 200, 0, 2, 0);
        _settle(k, ts, px, _two(alice.addr, bob.addr));
        assertEq(_credit(alice.addr), 100e6 - 7e6 + 10e6);
        assertEq(_credit(bob.addr), 99e6);
        assertEq(_openMask(alice.addr), 0);
        assertEq(game.house(), HOUSE - 5e6 + 2e6 + 1e6);
        assertEq(game.houseLiab(), 0);
        assertEq(game.openLiability(), 0);
        assertEq(game.totalOpen(), 0);
        assertEq(game.netLossToday(), 2e6);
        (, uint8 state, bool gap,,) = game.columnOf(A, k);
        assertEq(state, 2);
        assertFalse(gap);
        _assertTreasury();
    }

    function test_settle_gap_voids_untouched() public {
        uint32 k = _ready();
        int32 jw = _flatBand(k, PRICE);
        _bet(alice, k, jw, 1e6, 0);                                                // touched before the gap: WIN
        _bet(alice, k, jw + 3, 2e6, 1);                                            // untouched: VOID (not LOSS)
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        (ts, px) = _drop(ts, px, 50, 2);                                           // a 300 ms segment late in the span
        _settle(k, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 100e6 - 3e6 + 2e6 + 2e6);
        (,, bool gap,,) = game.columnOf(A, k);
        assertTrue(gap);
        assertEq(game.house(), HOUSE - 1e6);
        _assertTreasury();
    }

    function test_settle_gap_before_touch_voids_all() public {
        uint32 k = _ready();
        int32 jw = _flatBand(k, PRICE);
        _bet(alice, k, jw, 1e6, 0);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        (ts, px) = _drop(ts, px, 1, 2);                                            // first overlapping segment is 300 ms
        _settle(k, ts, px, _one(alice.addr));
        assertEq(_credit(alice.addr), 100e6);
        (,,,, uint256 touched) = game.columnOf(A, k);
        assertEq(touched, 0);
        _assertTreasury();
    }

    /// The bitmap is stored: later calls settle more players without a tape, even after the void deadline.
    function test_settle_later_players_use_stored_result() public {
        uint32 k = _ready();
        _grant(bob.addr);
        int32 jw = _flatBand(k, PRICE);
        _bet(alice, k, jw + 1, 1e6, 0);
        _bet(bob, k, jw, 1e6, 0);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _one(alice.addr));
        assertEq(_credit(bob.addr), 99e6);
        vm.warp(block.timestamp + 1 days);
        game.settleColumn(A, k, new uint64[](0), new uint64[](0), "", _one(bob.addr));
        assertEq(_credit(bob.addr), 101e6);
        _assertTreasury();
    }

    /// No double settle: duplicates in the list and repeated calls change nothing.
    function test_settle_no_double() public {
        uint32 k = _ready();
        _bet(alice, k, _flatBand(k, PRICE), 1e6, 0);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _two(alice.addr, alice.addr));
        assertEq(_credit(alice.addr), 101e6);
        uint256 h = game.house();
        vm.recordLogs();
        _settle(k, ts, px, _one(alice.addr));
        game.voidColumn(A, k, _one(alice.addr));
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(_credit(alice.addr), 101e6);
        assertEq(game.house(), h);
        _assertTreasury();
    }

    /// A player with bets on other columns keeps them; a stranger in the list is skipped.
    function test_settle_only_column_k() public {
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);
        _bet(alice, k + 1, 2400, 1e6, 1);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _two(makeAddr("stranger"), alice.addr));
        assertEq(_openMask(alice.addr), 2);
        assertEq(game.totalOpen(), 1e6);
        _assertTreasury();
    }

    /// I3: pause never blocks settle, void or withdraw.
    function test_pause_never_blocks_exits() public {
        uint32 k = _ready();
        _bet(alice, k, _flatBand(k, PRICE), 1e6, 0);
        _bet(alice, k + 1, 2400, 1e6, 1);
        vm.prank(guardian); game.setPause(3, true);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _one(alice.addr));
        vm.warp(uint256(HexGeo.tHi(k + 1) + 120_000) / 1000 + 1);
        game.voidColumn(A, k + 1, _one(alice.addr));
        vm.prank(alice.addr); game.withdraw(10e6);
        _withdrawFor(alice, 10e6, 2, uint64(block.timestamp), 0);
        assertEq(usdc.balanceOf(alice.addr), 20e6);
        _assertTreasury();
    }

    function test_settle_BadTape() public {
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        address[] memory who = _one(alice.addr);
        (uint64[] memory t1, uint64[] memory p1) = _slice(ts, px, 0, 1);
        bytes memory sig = _tapeSig(recorder.privateKey, k, t1, p1);
        vm.expectRevert(HexitGame.BadTape.selector); game.settleColumn(A, k, t1, p1, sig, who);          // < 2 ticks
        sig = _tapeSig(recorder.privateKey, k, ts, px);
        (, p1) = _slice(ts, px, 0, ts.length - 1);
        vm.expectRevert(HexitGame.BadTape.selector); game.settleColumn(A, k, ts, p1, sig, who);          // length mismatch
        (t1, p1) = _slice(ts, px, 1, ts.length);                                                       // starts after tLo
        sig = _tapeSig(recorder.privateKey, k, t1, p1);
        vm.expectRevert(HexitGame.BadTape.selector); game.settleColumn(A, k, t1, p1, sig, who);
        (t1, p1) = _slice(ts, px, 0, ts.length - 1);                                                   // ends before tHi
        sig = _tapeSig(recorder.privateKey, k, t1, p1);
        vm.expectRevert(HexitGame.BadTape.selector); game.settleColumn(A, k, t1, p1, sig, who);
        _settle(k, ts, px, who);                                                                       // exact cover passes
    }

    function test_settle_TooLate() public {
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);
        uint256 deadline = uint256(HexGeo.tHi(k)) + 120_000;
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        bytes memory sig = _tapeSig(recorder.privateKey, k, ts, px);
        vm.warp(deadline / 1000 + 1);
        vm.expectRevert(HexitGame.TooLate.selector); game.settleColumn(A, k, ts, px, sig, _one(alice.addr));
        vm.warp(deadline / 1000);
        game.settleColumn(A, k, ts, px, sig, _one(alice.addr));
    }

    function test_settle_TickInFuture() public {
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        bytes memory sig = _tapeSig(recorder.privateKey, k, ts, px);
        uint256 last = ts[ts.length - 1];
        vm.warp((last - 1000) / 1000 - 1);                                         // last tick > block time + 1 s
        vm.expectRevert(HexitGame.TickInFuture.selector); game.settleColumn(A, k, ts, px, sig, _one(alice.addr));
        vm.warp((last - 1000 + 999) / 1000);                                       // last tick <= block time + 1 s
        game.settleColumn(A, k, ts, px, sig, _one(alice.addr));
    }

    function test_settle_NotRecorder_and_BadSig() public {
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        address[] memory who = _one(alice.addr);
        bytes memory sig = _tapeSig(quoter.privateKey, k, ts, px);
        vm.expectRevert(HexitGame.NotRecorder.selector); game.settleColumn(A, k, ts, px, sig, who);       // wrong key
        sig = _tapeSig(recorder.privateKey, k, ts, px);
        px[10] += 1;                                                                                    // tape edited after signing
        vm.expectRevert(HexitGame.NotRecorder.selector); game.settleColumn(A, k, ts, px, sig, who);
        px[10] -= 1;
        vm.expectRevert(HexitGame.NotRecorder.selector); game.settleColumn(A, k + 1, ts, px, sig, who);   // signed for another k
        vm.expectRevert(HexitGame.BadSig.selector); game.settleColumn(A, k, ts, px, new bytes(65), who);  // malformed
        bytes memory other = _signDom(recorder.privateKey, _domain(1, address(game)), keccak256(abi.encode(keccak256(bytes(TAPE_T)), k, _ticksHash(ts, px))));
        vm.expectRevert(HexitGame.NotRecorder.selector); game.settleColumn(A, k, ts, px, other, who);     // other chain's domain
        game.settleColumn(A, k, ts, px, sig, who);
    }

    function test_settle_OffGrid() public {
        uint32 k = _ready();
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        ts[5] += 50;
        _expectSettle(k, ts, px, HexitGame.OffGrid.selector);
    }

    function test_settle_TickNotNewer() public {
        uint32 k = _ready();
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        ts[5] = ts[4];
        _expectSettle(k, ts, px, HexitGame.TickNotNewer.selector);
        ts[5] = ts[4] - 100;
        _expectSettle(k, ts, px, HexitGame.TickNotNewer.selector);
    }

    function test_settle_MoveTooLarge() public {
        uint32 k = _ready();
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        for (uint256 i = 10; i < px.length; ++i) px[i] = PRICE + 25_000_001;       // one step of 5 bands + 1
        _expectSettle(k, ts, px, HexitGame.MoveTooLarge.selector);
        for (uint256 i = 10; i < px.length; ++i) px[i] = PRICE + 25_000_000;       // exactly maxMoveE8 per 100 ms
        _settle(k, ts, px, new address[](0));
    }

    /// A longer step allows a proportionally larger move (the rule heals itself after a recorder gap).
    function test_settle_move_scales_with_gap() public {
        uint32 k = _ready();
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        (ts, px) = _drop(ts, px, 20, 9);                                           // a 1 s step
        for (uint256 i = 20; i < px.length; ++i) px[i] = PRICE + 250_000_000;      // 10 x maxMove in 1 s
        _settle(k, ts, px, new address[](0));
    }

    // ================================================================== void
    function test_void_refunds_exactly() public {
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);
        _betAt(alice, k, 2401, 2e6, 1, 350);
        _betAt(alice, k, 2380, 3e6, 2, 9000);
        _bet(alice, k + 1, 2400, 4e6, 3);
        uint256 deadline = uint256(HexGeo.tHi(k)) + 120_000;
        vm.warp(deadline / 1000);
        vm.expectRevert(HexitGame.TooEarly.selector); game.voidColumn(A, k, _one(alice.addr));
        vm.warp(deadline / 1000 + 1);
        vm.expectEmit(address(game)); emit HexitGame.ColumnVoided(A, k);
        vm.expectEmit(address(game)); emit HexitGame.BetSettled(alice.addr, A, k, 2400, 1e6, 200, 0, 3, 1e6);
        game.voidColumn(A, k, _one(alice.addr));
        assertEq(_credit(alice.addr), 100e6 - 4e6);                                // 1 + 2 + 3 back exactly
        assertEq(_openMask(alice.addr), 8);                                        // k+1 still open
        assertEq(game.house(), HOUSE);
        assertEq(game.houseLiab(), 4e6);
        assertEq(game.openLiability(), 8e6);
        _assertTreasury();
    }

    function test_void_after_settle_keeps_result_and_settle_after_void_refunds() public {
        uint32 k = _ready();
        _grant(bob.addr);
        _bet(alice, k, _flatBand(k, PRICE) + 2, 1e6, 0);
        _bet(bob, k, _flatBand(k, PRICE) + 2, 1e6, 0);
        _afterSpan(k);
        (uint64[] memory ts, uint64[] memory px) = _flatTape(k, PRICE);
        _settle(k, ts, px, _one(alice.addr));
        vm.warp(block.timestamp + 1 days);
        game.voidColumn(A, k, _one(bob.addr));                                        // decided column: LOSS, not a refund
        assertEq(_credit(bob.addr), 99e6);
        // and the other way round on the next column
        uint32 k2 = _openK();
        _bet(alice, k2, 2400, 1e6, 1);
        _bet(bob, k2, 2400, 1e6, 1);
        vm.warp(uint256(HexGeo.tHi(k2) + 120_000) / 1000 + 1);
        game.voidColumn(A, k2, _one(alice.addr));
        game.settleColumn(A, k2, ts, px, "", _one(bob.addr));                         // tape ignored once voided
        assertEq(_credit(bob.addr), 99e6);
        assertEq(_openMask(bob.addr), 0);
        _assertTreasury();
    }

    // ================================================================== withdraw / deposit
    function _withdrawFor(Vm.Wallet memory w, uint64 amount, uint64 nonce, uint64 deadline, bytes4 err) internal {
        bytes memory sig = _withdrawSig(w, amount, nonce, deadline);
        if (err != 0) vm.expectRevert(err);
        vm.prank(relayer);
        game.withdrawFor(w.addr, amount, nonce, deadline, sig);
    }

    /// T-DEST: withdrawFor pays only the player, whoever submits it.
    function test_withdrawFor() public {
        _grant(alice.addr);
        vm.expectEmit(address(game)); emit HexitGame.Withdrawn(alice.addr, 40e6);
        _withdrawFor(alice, 40e6, 0, uint64(block.timestamp), 0);
        assertEq(usdc.balanceOf(alice.addr), 40e6);
        assertEq(usdc.balanceOf(relayer), 0);
        assertEq(_credit(alice.addr), 60e6);
        assertEq(game.totalCredit(), 60e6);
        _assertTreasury();
    }

    function test_withdrawFor_guards() public {
        _grant(alice.addr);
        uint64 dl = uint64(block.timestamp);
        bytes memory sig = _withdrawSig(alice, 1e6, 0, dl);
        vm.expectRevert(HexitGame.BadSig.selector); game.withdrawFor(alice.addr, 2e6, 0, dl, sig);  // amount edited
        vm.expectRevert(HexitGame.BadSig.selector); game.withdrawFor(bob.addr, 1e6, 0, dl, sig);    // redirected
        _withdrawFor(alice, 1e6, 0, dl - 1, HexitGame.Expired.selector);
        _withdrawFor(alice, 0, 0, dl, HexitGame.InsufficientCredit.selector);
        _withdrawFor(alice, 100e6 + 1, 0, dl, HexitGame.InsufficientCredit.selector);
        game.withdrawFor(alice.addr, 1e6, 0, dl, sig);                                              // anyone may submit
        vm.expectRevert(HexitGame.NonceUsed.selector); game.withdrawFor(alice.addr, 1e6, 0, dl, sig); // replay
        _withdrawFor(alice, 99e6, 1, dl, 0);                                                        // all of it
        assertEq(_credit(alice.addr), 0);
    }

    function test_withdraw_direct() public {
        _grant(alice.addr);
        vm.prank(alice.addr); vm.expectRevert(HexitGame.InsufficientCredit.selector); game.withdraw(100e6 + 1);
        vm.prank(alice.addr); vm.expectRevert(HexitGame.InsufficientCredit.selector); game.withdraw(0);
        vm.prank(alice.addr); game.withdraw(100e6);
        assertEq(usdc.balanceOf(alice.addr), 100e6);
        _assertTreasury();
    }

    function _depositFor(Vm.Wallet memory w, uint64 amount, uint64 nonce, uint64 deadline, bytes4 err) internal {
        bytes memory sig = _depositSig(w, amount, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = _permit(w, amount, deadline);
        if (err != 0) vm.expectRevert(err);
        vm.prank(relayer);
        game.depositFor(w.addr, amount, nonce, deadline, sig, v, r, s);
    }

    function test_depositFor() public {
        _grant(alice.addr);
        vm.prank(alice.addr); game.withdraw(50e6);
        vm.expectEmit(address(game)); emit HexitGame.Deposited(alice.addr, 20e6);
        _depositFor(alice, 20e6, 0, uint64(block.timestamp + 60), 0);
        assertEq(_credit(alice.addr), 70e6);
        assertEq(usdc.balanceOf(alice.addr), 30e6);
        assertEq(usdc.allowance(alice.addr, address(game)), 0);
        assertEq(game.totalCredit(), 70e6);
        _assertTreasury();
    }

    /// The permit was front-run (used directly on the token): depositFor still works off the allowance.
    function test_depositFor_permit_frontrun() public {
        _grant(alice.addr);
        vm.prank(alice.addr); game.withdraw(50e6);
        uint64 dl = uint64(block.timestamp + 60);
        bytes memory sig = _depositSig(alice, 20e6, 0, dl);
        (uint8 v, bytes32 r, bytes32 s) = _permit(alice, 20e6, dl);
        vm.prank(bob.addr); usdc.permit(alice.addr, address(game), 20e6, dl, v, r, s);
        vm.prank(relayer); game.depositFor(alice.addr, 20e6, 0, dl, sig, v, r, s);
        assertEq(_credit(alice.addr), 70e6);
        _assertTreasury();
    }

    function test_depositFor_guards() public {
        _grant(alice.addr);
        vm.prank(alice.addr); game.withdraw(50e6);
        uint64 dl = uint64(block.timestamp + 60);
        vm.prank(guardian); game.setPause(1, true);
        _depositFor(alice, 1e6, 0, dl, HexitGame.IsPaused.selector);
        vm.prank(owner); game.setPause(1, false);
        bytes memory sig = _depositSig(bob, 1e6, 0, dl);                            // bob's signature for alice's funds
        (uint8 v, bytes32 r, bytes32 s) = _permit(alice, 1e6, dl);
        vm.expectRevert(HexitGame.BadSig.selector); game.depositFor(alice.addr, 1e6, 0, dl, sig, v, r, s);
        _depositFor(alice, 1e6, 0, uint64(block.timestamp - 1), HexitGame.Expired.selector);
        _depositFor(alice, 1e6, 0, dl, 0);
        _depositFor(alice, 1e6, 0, dl, HexitGame.NonceUsed.selector);
        _assertTreasury();
    }

    // ================================================================== house
    function test_house_moves() public {
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); game.houseWithdraw(1);
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); game.houseDeposit(1);
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); game.sweep();
        vm.prank(owner); vm.expectRevert(HexitGame.ReserveBreach.selector); game.houseWithdraw(HOUSE + 1);
        uint32 k = _ready();
        _bet(alice, k, 2400, 1e6, 0);                                              // houseLiab 1e6
        vm.prank(owner); vm.expectRevert(HexitGame.ReserveBreach.selector); game.houseWithdraw(HOUSE - 1e6 + 1);
        vm.expectEmit(address(game)); emit HexitGame.HouseWithdraw(HOUSE - 1e6);
        vm.prank(owner); game.houseWithdraw(HOUSE - 1e6);                          // T-DEST: pays the owner
        assertEq(usdc.balanceOf(owner), HOUSE - 1e6);
        vm.prank(owner); game.houseDeposit(5e6);
        assertEq(game.house(), 6e6);
        _assertTreasury();
    }

    /// T-DONATE: a direct transfer never breaks I1; sweep books it into house.
    function test_sweep() public {
        _grant(alice.addr);
        vm.prank(alice.addr); game.withdraw(5e6);
        vm.prank(alice.addr); usdc.transfer(address(game), 5e6);
        vm.expectEmit(address(game)); emit HexitGame.Swept(5e6);
        vm.prank(owner); game.sweep();
        assertEq(game.house(), HOUSE + 5e6);
        vm.prank(owner); game.sweep();
        assertEq(game.house(), HOUSE + 5e6);
        _assertTreasury();
    }

    /// I1 is enforced: if the game's token balance ever falls short, money paths revert.
    function test_TreasuryMismatch() public {
        _grant(alice.addr);
        deal(address(usdc), address(game), usdc.balanceOf(address(game)) - 1);
        vm.prank(alice.addr); vm.expectRevert(HexitGame.TreasuryMismatch.selector); game.withdraw(1e6);
        vm.expectRevert(HexitGame.TreasuryMismatch.selector);
        vm.prank(relayer); game.grant(bob.addr);
    }

    // ================================================================== T-SIG: domain separation
    function test_sig_domain() public {
        uint32 k = _ready();
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(alice, k, 2400, 1e6, 0);
        bytes memory qs = _sign(quoter.privateKey, _quoteHash(q, m));
        bytes32 bh = _betHash(b);
        bytes memory s1 = _signDom(alice.privateKey, _domain(1, address(game)), bh);           // wrong chainId
        bytes memory s2 = _signDom(alice.privateKey, _domain(CHAIN, address(0xdead)), bh);     // wrong contract
        vm.startPrank(relayer);
        vm.expectRevert(HexitGame.BadSig.selector); game.placeBetFor(b, s1, q, m, qs);
        vm.expectRevert(HexitGame.BadSig.selector); game.placeBetFor(b, s2, q, m, qs);
        bytes memory q1 = _signDom(quoter.privateKey, _domain(1, address(game)), _quoteHash(q, m));
        bytes memory s = _sign(alice.privateKey, bh);
        vm.expectRevert(HexitGame.NotQuoter.selector); game.placeBetFor(b, s, q, m, q1);
        // a quote signature is not a bet signature (type separation)
        vm.expectRevert(HexitGame.BadSig.selector); game.placeBetFor(b, qs, q, m, qs);
        vm.stopPrank();
        // a valid signature stops working when the chain id changes (no cross-chain replay)
        vm.chainId(1);
        vm.prank(relayer); vm.expectRevert(HexitGame.BadSig.selector); game.placeBetFor(b, s, q, m, qs);
    }

    // ------------------------------------------------------------------ tape helpers
    function _expectSettle(uint32 k, uint64[] memory ts, uint64[] memory px, bytes4 err) internal {
        bytes memory sig = _tapeSig(recorder.privateKey, k, ts, px);
        vm.expectRevert(err);
        game.settleColumn(A, k, ts, px, sig, new address[](0));
    }

    function _slice(uint64[] memory ts, uint64[] memory px, uint256 a, uint256 b) internal pure returns (uint64[] memory t, uint64[] memory p) {
        t = new uint64[](b - a);
        p = new uint64[](b - a);
        for (uint256 i = a; i < b; ++i) { t[i - a] = ts[i]; p[i - a] = px[i]; }
    }

    /// Removes `n` ticks starting at index `from`.
    function _drop(uint64[] memory ts, uint64[] memory px, uint256 from, uint256 n) internal pure returns (uint64[] memory t, uint64[] memory p) {
        t = new uint64[](ts.length - n);
        p = new uint64[](ts.length - n);
        for (uint256 i; i < t.length; ++i) { uint256 s = i < from ? i : i + n; t[i] = ts[s]; p[i] = px[s]; }
    }
}
