// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test, Vm} from "forge-std/Test.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {HexGeo} from "../src/HexGeo.sol";
import {Base} from "./Base.t.sol";

/// Random play against one game on two markets (asset 1 at row 0.05, asset 3 at row 0.10) sharing one credit balance:
/// grants, signed bets, recorder-signed random-walk tapes (some with gaps), voids,
/// withdrawals (direct and signed), permit deposits, house moves, pauses, donations and time. Every action is
/// valid by construction (fail_on_revert = true), so a revert is itself a failure. Some checks run inside actions:
/// VOID refunds exactly, withdrawals pay only the player (I2) and still work while paused (I3).
contract Handler is Test {
    HexitGame game;
    TestUSDC usdc;
    address owner;
    address guardian;
    address relayer;
    uint256 recKey;
    uint256 quoKey;
    bytes32 dom;
    Vm.Wallet[4] players;
    uint64[4] nextNonce;

    uint256[] public cols;                      // columns with bets as asset << 32 | k, in order placed
    mapping(uint256 => bool) public decided;
    uint256 public donated;                     // tUSDC sent straight to the game and not yet swept
    uint256 public placed;                      // successful bets
    uint256 public settledEvents;               // BetSettled events seen

    uint64 constant PRICE = 12_002_250_000;
    bytes32 constant BET_T = keccak256("Bet(address player,uint8 asset,uint32 k,int32 j,uint64 stake,uint16 minMult,uint64 nonce,uint64 deadline)");
    bytes32 constant QUOTE_T = keccak256("Quote(uint8 asset,int64 rowE8,uint32 k,int32 qJ0,uint64 refTsMs,uint64 refPriceE8,uint64 expiresMs,bytes32 multsHash)");
    bytes32 constant TAPE_T = keccak256("ColumnTape(uint8 asset,uint32 k,bytes32 ticksHash)");
    bytes32 constant WITHDRAW_T = keccak256("Withdraw(address player,uint64 amount,uint64 nonce,uint64 deadline)");
    bytes32 constant DEPOSIT_T = keccak256("Deposit(address player,uint64 amount,uint64 nonce,uint64 deadline)");

    constructor(HexitGame g, TestUSDC u, address o, address gd, address rl, uint256 rk, uint256 qk, bytes32 d) {
        (game, usdc, owner, guardian, relayer, recKey, quoKey, dom) = (g, u, o, gd, rl, rk, qk, d);
        for (uint256 i; i < 4; ++i) players[i] = vm.createWallet(string.concat("inv", vm.toString(i)));
    }

    function playerAt(uint256 i) external view returns (address) { return players[i].addr; }

    function _sig(uint256 key, bytes32 sh) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", dom, sh)));
        return abi.encodePacked(r, s, v);
    }

    function _all() internal view returns (address[] memory a) {
        a = new address[](4);
        for (uint256 i; i < 4; ++i) a[i] = players[i].addr;
    }

    function _countSettled() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) if (logs[i].topics[0] == HexitGame.BetSettled.selector) ++settledEvents;
    }

    // ------------------------------------------------------------------ actions
    function grant(uint256 pi) external {
        address p = players[pi % 4].addr;
        (,,,,, bool granted,) = game.playerOf(p);
        if (granted) return;
        vm.prank(relayer);
        game.grant(p);
    }

    function bet(uint256 pi, uint256 dk, uint256 dj, uint256 stake, uint256 mult, bool mon) external {
        Vm.Wallet memory w = players[pi % 4];
        uint8 asset = mon ? 3 : 1;
        int32 band = mon ? int32(1200) : int32(2400);                              // PRICE at row 0.10 / 0.05
        (uint64 credit,,,, uint32 open,,) = game.playerOf(w.addr);
        stake = bound(stake, 100_000, 2_000_000);
        mult = bound(mult, 101, 1000);
        uint256 payout = stake * mult / 100;
        if (credit < stake || open == type(uint32).max || game.paused() & 2 != 0) return;
        if (game.houseLiab() + payout - stake > game.house()) return;
        uint256 nowMs = block.timestamp * 1000;
        uint32 k = uint32(uint256(HexGeo.ceilDiv(int256(nowMs) + 6100 + 834, 5000)) + bound(dk, 0, 8));
        int32 j = band - 6 + int32(int256(bound(dj, 0, 12)));
        _place(w, HexitGame.Bet(w.addr, asset, k, j, uint64(stake), uint16(mult), nextNonce[pi % 4], uint64(block.timestamp + 10)),
            HexitGame.Quote(asset, mon ? int64(10_000_000) : int64(5_000_000), k, band - 32, uint64(nowMs), PRICE, uint64(nowMs + 1500)));
        ++nextNonce[pi % 4];
        ++placed;
        uint256 key = uint256(asset) << 32 | k;
        if (cols.length == 0 || cols[cols.length - 1] != key) cols.push(key);
    }

    /// Signs (every band at the bet's minMult) and relays.
    function _place(Vm.Wallet memory w, HexitGame.Bet memory b, HexitGame.Quote memory q) internal {
        uint16[64] memory m;
        for (uint256 i; i < 64; ++i) m[i] = b.minMult;
        bytes memory s = _sig(w.privateKey, keccak256(abi.encode(BET_T, b.player, b.asset, b.k, b.j, b.stake, b.minMult, b.nonce, b.deadline)));
        bytes32 mh = keccak256(abi.encodePacked(m));
        bytes memory qs = _sig(quoKey, keccak256(abi.encode(QUOTE_T, q.asset, q.rowE8, q.k, q.qJ0, q.refTsMs, q.refPriceE8, q.expiresMs, mh)));
        vm.prank(relayer);
        game.placeBetFor(b, s, q, m, qs);
    }

    /// Settles the oldest undecided column from a random-walk tape (1 in 6 has a 300 ms gap), or voids it once
    /// its tape deadline has passed.
    function settle(uint256 seed) external {
        uint256 key;
        bool found;
        for (uint256 i; i < cols.length; ++i) if (!decided[cols[i]]) { key = cols[i]; found = true; break; }
        if (!found) return;
        (uint8 asset, uint32 k) = (uint8(key >> 32), uint32(key));
        if (block.timestamp * 1000 > uint256(HexGeo.tHi(k) + 120_000)) return _void(asset, k);
        uint256 t = uint256(HexGeo.tHi(k)) / 1000 + 1;
        if (block.timestamp < t) vm.warp(t);
        uint256 n = 69;
        bool gap = seed % 6 == 0;
        uint64[] memory ts = new uint64[](gap ? n - 2 : n);
        uint64[] memory px = new uint64[](ts.length);
        uint256 p = PRICE;
        uint256 x;
        for (uint256 i; i < n; ++i) {
            if (gap && (i == 30 || i == 31)) continue;
            p = p + (uint256(keccak256(abi.encode(seed, i))) % 4_000_001) - 2_000_000;   // within +-0.4 band per tick
            ts[x] = uint64(uint256(5000) * k - 900 + 100 * i);
            px[x] = uint64(p);
            ++x;
        }
        bytes memory buf;
        for (uint256 i; i < ts.length; ++i) buf = abi.encodePacked(buf, ts[i], px[i]);
        bytes memory sig = _sig(recKey, keccak256(abi.encode(TAPE_T, asset, k, keccak256(buf))));
        vm.recordLogs();
        game.settleColumn(asset, k, ts, px, sig, _all());
        _countSettled();
        decided[key] = true;
    }

    function voidCol(uint256 ci) external {
        if (cols.length == 0) return;
        uint256 key = cols[ci % cols.length];
        if (decided[key]) return;
        uint32 k = uint32(key);
        uint256 t = uint256(HexGeo.tHi(k) + 120_000) / 1000 + 1;
        if (block.timestamp < t) vm.warp(t);
        _void(uint8(key >> 32), k);
    }

    /// VOID refunds exactly: each player's credit rises by the stakes of their open bets on (asset, k), and those
    /// close; bets on the same k of the other market stay open.
    function _void(uint8 asset, uint32 k) internal {
        uint256[4] memory refund;
        for (uint256 i; i < 4; ++i) {
            (,,,, uint32 open,, uint256[16] memory bets) = game.playerOf(players[i].addr);
            for (uint256 s; s < 32; ++s) {
                uint256 rec = uint128(bets[s >> 1] >> (128 * (s & 1)));
                if ((open >> s) & 1 == 1 && _on(rec, asset, k)) refund[i] += uint32(rec >> 64);
            }
            refund[i] += _credit(players[i].addr);
        }
        vm.recordLogs();
        game.voidColumn(asset, k, _all());
        _countSettled();
        decided[uint256(asset) << 32 | k] = true;
        for (uint256 i; i < 4; ++i) {
            assertEq(_credit(players[i].addr), refund[i], "VOID refund");
            (,,,, uint32 open,, uint256[16] memory bets) = game.playerOf(players[i].addr);
            for (uint256 s; s < 32; ++s) if ((open >> s) & 1 == 1) assertFalse(_on(uint128(bets[s >> 1] >> (128 * (s & 1))), asset, k), "bet left open");
        }
    }

    function _on(uint256 rec, uint8 asset, uint32 k) internal pure returns (bool) { return uint32(rec) == k && uint8(rec >> 112) == asset; }

    function _credit(address p) internal view returns (uint64 c) { (c,,,,,,) = game.playerOf(p); }

    /// I2 + I3: pays only the player, whatever the pause bits.
    function withdraw(uint256 pi, uint256 amt, bool signed) external {
        Vm.Wallet memory w = players[pi % 4];
        uint64 credit = _credit(w.addr);
        if (credit == 0) return;
        uint64 a = uint64(bound(amt, 1, credit));
        uint256 gameBal = usdc.balanceOf(address(game));
        uint256 bal = usdc.balanceOf(w.addr);
        uint256 relBal = usdc.balanceOf(relayer);
        if (signed) {
            uint64 dl = uint64(block.timestamp);
            uint64 n = nextNonce[pi % 4]++;
            bytes memory sig = _sig(w.privateKey, keccak256(abi.encode(WITHDRAW_T, w.addr, a, n, dl)));
            vm.prank(relayer);
            game.withdrawFor(w.addr, a, n, dl, sig);
        } else {
            vm.prank(w.addr);
            game.withdraw(a);
        }
        assertEq(usdc.balanceOf(w.addr), bal + a, "I2 player");
        assertEq(usdc.balanceOf(address(game)), gameBal - a, "I2 game");
        assertEq(usdc.balanceOf(relayer), relBal, "I2 relayer");
    }

    function deposit(uint256 pi, uint256 amt) external {
        Vm.Wallet memory w = players[pi % 4];
        uint256 bal = usdc.balanceOf(w.addr);
        if (bal == 0 || game.paused() & 1 != 0) return;
        uint64 a = uint64(bound(amt, 1, bal));
        uint64 dl = uint64(block.timestamp + 60);
        uint64 n = nextNonce[pi % 4]++;
        bytes memory sig = _sig(w.privateKey, keccak256(abi.encode(DEPOSIT_T, w.addr, a, n, dl)));
        bytes32 ph = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            w.addr, address(game), uint256(a), usdc.nonces(w.addr), uint256(dl)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), ph)));
        vm.prank(relayer);
        game.depositFor(w.addr, a, n, dl, sig, v, r, s);
    }

    function house(uint256 amt, bool dep) external {
        if (dep) {
            uint64 a = uint64(bound(amt, 1, 1_000_000e6));
            vm.startPrank(owner);
            usdc.mint(owner, a);
            game.houseDeposit(a);
            vm.stopPrank();
        } else {
            uint256 free = game.house() - game.houseLiab();
            if (free == 0) return;
            vm.prank(owner);
            game.houseWithdraw(uint64(bound(amt, 1, free)));
        }
    }

    function pause(uint8 bits, bool on) external {
        bits = uint8(bound(bits, 1, 3));
        vm.prank(on ? guardian : owner);
        game.setPause(bits, on);
    }

    function donate(uint256 amt, bool sweep) external {
        if (sweep) {
            vm.prank(owner);
            game.sweep();
            donated = 0;
            return;
        }
        uint256 a = bound(amt, 1, 1_000e6);
        vm.prank(owner);
        usdc.mint(address(game), a);
        donated += a;
    }

    function warp(uint256 dt) external { vm.warp(block.timestamp + bound(dt, 0, 30)); }
}

contract InvariantTest is Base {
    Handler h;

    function setUp() public override {
        super.setUp();
        vm.startPrank(owner);
        usdc.approve(address(game), type(uint256).max);
        game.setMarket(3, _cfg(2 * ROW));
        vm.stopPrank();
        h = new Handler(game, usdc, owner, guardian, relayer, recorder.privateKey, quoter.privateKey, dom);
        for (uint256 i; i < 3; ++i) _grant(h.playerAt(i));                       // the 4th is granted by the handler
        targetContract(address(h));
    }

    /// I1 (with equality, counting unswept donations), I-solv, Σ credit / Σ open stake, the liability books (total and
    /// per market), and no double settle (every placed bet is either still open or produced exactly one BetSettled).
    function invariant_accounting() public view {
        assertEq(usdc.balanceOf(address(game)), uint256(game.house()) + game.totalCredit() + game.totalOpen() + h.donated(), "I1");
        assertLe(game.houseLiab(), game.house(), "I-solv");
        uint256 credit;
        uint256 openStake;
        uint256 liab;
        uint256 payouts;
        uint256[4] memory byAsset;
        uint256 openBets;
        for (uint256 i; i < 4; ++i) {
            (uint64 c, uint64 o,,, uint32 mask,, uint256[16] memory bets) = game.playerOf(h.playerAt(i));
            credit += c;
            openStake += o;
            uint256 sum;
            for (uint256 s; s < 32; ++s) {
                if ((mask >> s) & 1 == 0) continue;
                uint256 rec = uint128(bets[s >> 1] >> (128 * (s & 1)));
                uint256 stake = uint32(rec >> 64);
                uint256 payout = stake * uint16(rec >> 96) / 100;
                sum += stake;
                liab += payout - stake;
                payouts += payout;
                byAsset[uint8(rec >> 112)] += payout;
                ++openBets;
            }
            assertEq(sum, o, "openStake = sum of open bets");
        }
        assertEq(credit, game.totalCredit(), "sum credit");
        assertEq(openStake, game.totalOpen(), "sum open");
        assertEq(liab, game.houseLiab(), "houseLiab");
        assertEq(payouts, game.openLiability(), "openLiability");
        (,,,, uint64 l1) = game.markets(1);
        (,,,, uint64 l3) = game.markets(3);
        assertEq(byAsset[1], l1, "market 1 liability");
        assertEq(byAsset[3], l3, "market 3 liability");
        assertEq(byAsset[0] + byAsset[2], 0, "no bets off the two markets");
        assertEq(h.settledEvents() + openBets, h.placed(), "each bet settles once");
    }
}
