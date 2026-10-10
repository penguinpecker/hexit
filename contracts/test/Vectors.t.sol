// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {HexGeo} from "../src/HexGeo.sol";
import {Base} from "./Base.t.sol";

/// Exposes the contract's own tape rule, _applyTape (the code settleColumn runs), without its tape preconditions.
contract TapeHarness is HexitGame {
    function applyTape(int256 row, uint32 k, int256 bJ0, uint64[] calldata ts, uint64[] calldata px) external returns (uint256, bool, int256) {
        return _applyTape(0, row, k, bJ0, ts, px);
    }
}

/// Vector gate, part 1: every seg case of the committed tests/vectors/hex_segments.json (read from the repo).
/// (A separate contract only because via_ir runs out of stack when this decoder shares a contract with VectorsTest.)
contract SegVectorsTest is Test {
    // forge decodes JSON objects as tuples with keys in byte order: uppercase before lowercase
    struct Seg { int256 P0; int256 P1; int256 T0; int256 T1; bool hit; int256 j; int256 k; string name; int256 row; }
    string constant FILE = "../tests/vectors/hex_segments.json";

    /// Every seg case: segHits == hit (2,413 cases, 1,371 hits), and bandRange never excludes a hit.
    function test_seg_vectors() public view {
        Seg[] memory s = abi.decode(vm.parseJson(vm.readFile(FILE), ".seg"), (Seg[]));
        uint256 hits;
        for (uint256 i; i < s.length; ++i) {
            bool got = HexGeo.segHits(s[i].T0, s[i].P0, s[i].T1, s[i].P1, s[i].k, s[i].j, s[i].row);
            assertEq(got, s[i].hit, s[i].name);
            if (got && s[i].k >= 0) {
                (int256 lo, int256 hi) = s[i].P0 < s[i].P1 ? (s[i].P0, s[i].P1) : (s[i].P1, s[i].P0);
                (int256 ja, int256 jb) = HexGeo.bandRange(uint256(s[i].k), lo, hi, s[i].row);
                assertTrue(ja <= s[i].j && s[i].j <= jb, "bandRange excludes a hit");
            }
            if (got) ++hits;
        }
        assertEq(s.length, 2413);
        assertEq(hits, 1371);
    }
}

/// Vector gate, part 2: the 40 settle tapes.
contract VectorsTest is Base {
    struct Res { int256 j; string onchain; string ref; }
    struct Case { uint256 gapMs; uint256 k; string name; Res[] results; uint256 row; uint256[][] ticks; }
    string constant FILE = "../tests/vectors/hex_segments.json";

    /// The 40 settle cases, parsed once (every cheatcode call copies the whole 494 KB file into memory).
    function _cases() internal view returns (Case[] memory cs) {
        cs = abi.decode(vm.parseJson(vm.readFile(FILE), ".settle"), (Case[]));
        assertEq(cs.length, 40);
    }

    /// All cases use row 5,000,000 and gap 250 ms, as the contract does.
    function _tape(Case memory c) internal pure returns (uint32 k, uint64[] memory ts, uint64[] memory px) {
        assertEq(c.row, uint256(uint64(ROW)));
        assertEq(c.gapMs, 250);
        k = uint32(c.k);
        ts = new uint64[](c.ticks.length);
        px = new uint64[](c.ticks.length);
        for (uint256 i; i < ts.length; ++i) { ts[i] = uint64(c.ticks[i][0]); px[i] = uint64(c.ticks[i][1]); }
    }

    function _code(string memory o) internal pure returns (uint8) {
        bytes32 h = keccak256(bytes(o));
        if (h == keccak256("WIN")) return 1;
        if (h == keccak256("LOSS")) return 2;
        if (h == keccak256("VOID")) return 3;
        return 0;                                                                  // PENDING
    }

    /// (a) The contract's tape rule reproduces all 360 settle.onchain outcomes exactly (40 tapes x 9 bands), with
    /// bJ0 = floor(first price / row) - 128 (the contract's _book takes the first bet's reference price, HexitGame.sol:351).
    function test_settle_vectors_rule() public {
        TapeHarness h = TapeHarness(address(new ERC1967Proxy(address(new TapeHarness()),
            abi.encodeCall(HexitGame.initialize, (owner, address(usdc), ROW, _params())))));
        Case[] memory cs = _cases();
        uint256 n;
        for (uint256 c; c < 40; ++c) {
            (uint32 k, uint64[] memory ts, uint64[] memory px) = _tape(cs[c]);
            Res[] memory r = cs[c].results;
            int256 bJ0 = HexGeo.floorDiv(int256(uint256(px[0])), ROW) - 128;
            (uint256 touched, bool gap, int256 chainTs) = h.applyTape(ROW, k, bJ0, ts, px);
            for (uint256 x; x < r.length; ++x) {
                uint8 got = (touched >> uint256(r[x].j - bJ0)) & 1 == 1 ? 1 : gap ? 3 : chainTs >= HexGeo.tHi(k) ? 2 : 0;
                assertEq(got, _code(r[x].onchain), string.concat("case ", vm.toString(c), " j ", vm.toString(r[x].j)));
                ++n;
            }
        }
        assertEq(n, 360);
    }

    /// (b) The same 40 tapes through real bets + settleColumn. A tape that covers the span and passes I11 (32 of 40)
    /// gives exactly settle.onchain per bet. The other 8 (observation starts late or ends early) are rejected and the
    /// column is VOIDed after voidAfterMs: every bet refunded. None of those 8 has an onchain LOSS.
    function test_settle_vectors_via_settleColumn() public {
        uint256 settled;
        for (uint256 c; c < 40; ++c) if (this.runCase(c)) ++settled;
        assertEq(settled, 32);
    }

    /// One tape: fresh game (every tape uses k 358000000/1), 9 bets, settle or void, outcomes checked from the logs.
    /// An external self-call so each case starts with fresh EVM memory.
    function runCase(uint256 c) external returns (bool ok) {
        Case memory cs = _cases()[c];
        (uint32 k, uint64[] memory ts, uint64[] memory px) = _tape(cs);
        Res[] memory r = cs.results;
        Base.setUp();
        Vm.Wallet memory w = vm.createWallet(string.concat("vec", vm.toString(c)));
        _grant(w.addr);
        _betAll(w, k, px[0], r);
        vm.warp(uint256(ts[ts.length - 1]) / 1000 + 1);
        bytes memory sig = _tapeSig(recorder.privateKey, k, ts, px);
        ok = _qualifies(k, ts);
        vm.recordLogs();
        if (ok) {
            game.settleColumn(A, k, ts, px, sig, _one(w.addr));
        } else {
            try game.settleColumn(A, k, ts, px, sig, _one(w.addr)) { revert("uncovered tape accepted"); } catch {}
            vm.warp(uint256(HexGeo.tHi(k) + 120_000) / 1000 + 1);
            game.voidColumn(A, k, _one(w.addr));
        }
        _checkLogs(c, ok, r);
        assertEq(_openMask(w.addr), 0);
        _assertTreasury();
    }

    /// Bets on the 9 result bands, quoted from the tape's first price (so bJ0 matches the rule test).
    function _betAll(Vm.Wallet memory w, uint32 k, uint64 px0, Res[] memory r) internal {
        vm.warp((uint256(HexGeo.tLo(k)) - 7000) / 1000);
        int256 jmin = type(int256).max;
        for (uint256 x; x < r.length; ++x) if (r[x].j < jmin) jmin = r[x].j;
        for (uint256 x; x < r.length; ++x) _betOne(w, k, r[x].j, jmin, px0, x);
    }

    function _betOne(Vm.Wallet memory w, uint32 k, int256 j, int256 qJ0, uint64 px0, uint256 nonce) internal {
        (HexitGame.Bet memory b, HexitGame.Quote memory q, uint16[64] memory m) = _pieces(w, k, int32(j), 1e6, uint64(nonce));
        q.qJ0 = int32(qJ0);
        q.refPriceE8 = px0;
        _submit(b, w.privateKey, q, m, quoter.privateKey, 0);
    }

    function _checkLogs(uint256 c, bool ok, Res[] memory r) internal view {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != HexitGame.BetSettled.selector) continue;
            (int256 j,,,, uint256 out, uint256 credited) = abi.decode(logs[i].data, (int256, uint256, uint256, uint256, uint256, uint256));
            uint256 want = _expected(r, j);
            if (ok) assertEq(out, want, string.concat("case ", vm.toString(c)));
            else { assertEq(out, 3); assertTrue(want != 2, "uncovered tape had a LOSS"); }
            assertEq(credited, out == 1 ? 2e6 : out == 3 ? 1e6 : 0);
            ++seen;
        }
        assertEq(seen, 9);
    }

    function _qualifies(uint32 k, uint64[] memory ts) internal pure returns (bool) {
        if (int256(uint256(ts[0])) > HexGeo.tLo(k) || int256(uint256(ts[ts.length - 1])) < HexGeo.tHi(k)) return false;
        for (uint256 i; i < ts.length; ++i) if (ts[i] % 100 != 0 || (i > 0 && ts[i] <= ts[i - 1])) return false;
        return true;
    }

    function _expected(Res[] memory r, int256 j) internal pure returns (uint8) {
        for (uint256 x; x < r.length; ++x) if (r[x].j == j) return _code(r[x].onchain);
        revert("band not in vectors");
    }
}
