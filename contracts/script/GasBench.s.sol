// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script, console} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {HexGeo} from "../src/HexGeo.sol";

/// Gas measurement on a LOCAL `anvil --network monad` only (run by gas.sh after script/Deploy.s.sol). Four phases,
/// each a separate broadcast so block time can move between them: prep (grants), bets, settle, money.
/// Recorder/quoter keys are throwaway wallets derived from public labels; prep points the game at them.
/// Both live markets are measured at their deployed rows: BTC (asset 1) at $82,385 and MON (asset 3) at $0.02436.
contract GasBench is Script {
    uint256 constant NP = 10;
    bytes32 constant BET_T = keccak256("Bet(address player,uint8 asset,uint32 k,int32 j,uint64 stake,uint16 minMult,uint64 nonce,uint64 deadline)");
    bytes32 constant QUOTE_T = keccak256("Quote(uint8 asset,int64 rowE8,uint32 k,int32 qJ0,uint64 refTsMs,uint64 refPriceE8,uint64 expiresMs,bytes32 multsHash)");
    bytes32 constant TAPE_T = keccak256("ColumnTape(uint8 asset,uint32 k,bytes32 ticksHash)");
    bytes32 constant WITHDRAW_T = keccak256("Withdraw(address player,uint64 amount,uint64 nonce,uint64 deadline)");
    bytes32 constant DEPOSIT_T = keccak256("Deposit(address player,uint64 amount,uint64 nonce,uint64 deadline)");

    struct Mkt { uint8 asset; uint64 price; uint64 row; }

    HexitGame game;
    TestUSDC usdc;
    Vm.Wallet recorder;
    Vm.Wallet quoter;
    Vm.Wallet[NP] p;
    uint64[NP] nonce;

    function _btc() internal pure returns (Mkt memory) { return Mkt(1, 8_238_500_000_000, 2_500_000_000); }
    function _mon() internal pure returns (Mkt memory) { return Mkt(3, 2_436_000, 2_000); }
    function _band(Mkt memory m) internal pure returns (int32) { return int32(int256(uint256(m.price / m.row))); }

    function _load() internal {
        string memory d = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        game = HexitGame(vm.parseJsonAddress(d, ".game"));
        usdc = TestUSDC(vm.parseJsonAddress(d, ".usdc"));
        recorder = vm.createWallet("hexit.bench.recorder");
        quoter = vm.createWallet("hexit.bench.quoter");
        for (uint256 i; i < NP; ++i) p[i] = vm.createWallet(string.concat("hexit.bench.p", vm.toString(i)));
        (int64 btcRow,,,,) = game.markets(1);
        (int64 monRow,,,,) = game.markets(3);
        require(uint64(btcRow) == _btc().row && uint64(monRow) == _mon().row, "bench rows differ from the deployed markets");
    }

    function _sig(uint256 key, bytes32 sh) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", game.domainSeparator(), sh)));
        return abi.encodePacked(r, s, v);
    }

    /// Admin: bench recorder/quoter keys, quoteMaxAgeMs 60 s (script latency; gas does not depend on it).
    /// Relayer: grant 10 players.
    function prep() external {
        _load();
        HexitGame.Params memory q = game.getParams();
        q.recorders[0] = recorder.addr;
        q.quoter = quoter.addr;
        q.quoteMaxAgeMs = 60_000;
        vm.broadcast(game.owner());
        game.setParams(q);
        vm.startBroadcast(q.relayer);
        for (uint256 i; i < NP; ++i) game.grant(p[i].addr);
        vm.stopBroadcast();
    }

    /// BTC columns: A 1 bet (p0); B 3 bets (p1..p3 on band-1, band, band+1: new column, new liability word, warm word);
    /// C 10 bets (p0..p9); D 1 bet (settled with an access list); E 1 bet (volatile tape).
    /// MON columns: F 1 bet (p0); G 3 bets (as B); H 1 bet (volatile tape).
    /// k0 is >= 10 s past the lock so broadcast latency cannot trip it.
    function bets() external {
        _load();
        uint256 nowMs = block.timestamp * 1000;
        uint32 k0 = uint32(uint256(HexGeo.ceilDiv(int256(nowMs) + 16_100 + 834, 5000)));
        (Mkt memory b, Mkt memory m) = (_btc(), _mon());
        (int32 bb, int32 mb) = (_band(b), _band(m));
        vm.startBroadcast(game.getParams().relayer);
        _bet(0, b, k0, bb);                                                        // A
        for (uint256 i = 1; i <= 3; ++i) _bet(i, b, k0 + 1, bb - 2 + int32(int256(i)));   // B
        for (uint256 i; i < NP; ++i) _bet(i, b, k0 + 2, bb - 5 + int32(int256(i)));       // C
        _bet(5, b, k0 + 3, bb);                                                    // D
        _bet(7, b, k0 + 4, bb);                                                    // E
        _bet(0, m, k0 + 5, mb);                                                    // F
        for (uint256 i = 1; i <= 3; ++i) _bet(i, m, k0 + 6, mb - 2 + int32(int256(i)));   // G
        _bet(8, m, k0 + 7, mb);                                                    // H
        vm.stopBroadcast();
        string memory o = "bench";
        vm.serializeUint(o, "k0", k0);
        vm.serializeUint(o, "settleAt", uint256(HexGeo.tHi(k0 + 7)) / 1000 + 2);
        o = vm.serializeBytes(o, "betCalldata", _betCalldata(6, b, k0 + 2, bb + 1)); // warm BTC bet, sent by gas.sh with an access list
        vm.writeJson(o, string.concat("deployments/gasbench-", vm.toString(block.chainid), ".json"));
    }

    function _bet(uint256 i, Mkt memory m, uint32 k, int32 j) internal {
        (bool ok,) = address(game).call(_betCalldata(i, m, k, j));
        require(ok, "bet");
        ++nonce[i];
    }

    function _betCalldata(uint256 i, Mkt memory m, uint32 k, int32 j) internal view returns (bytes memory) {
        uint256 nowMs = block.timestamp * 1000;
        HexitGame.Bet memory b = HexitGame.Bet(p[i].addr, m.asset, k, j, 1e6, 101, nonce[i], uint64(block.timestamp + 120));
        HexitGame.Quote memory q = HexitGame.Quote(m.asset, int64(m.row), k, _band(m) - 32, uint64(nowMs), m.price, uint64(nowMs + 120_000));
        uint16[64] memory mu;
        for (uint256 x; x < 64; ++x) mu[x] = uint16(150 + 10 * (x % 32));
        bytes memory s = _sig(p[i].privateKey, keccak256(abi.encode(BET_T, b.player, b.asset, b.k, b.j, b.stake, b.minMult, b.nonce, b.deadline)));
        bytes memory qs = _sig(quoter.privateKey, keccak256(abi.encode(QUOTE_T, q.asset, q.rowE8, q.k, q.qJ0, q.refTsMs, q.refPriceE8, q.expiresMs, keccak256(abi.encodePacked(mu)))));
        return abi.encodeCall(HexitGame.placeBetFor, (b, s, q, mu, qs));
    }

    /// Keeper: settleColumn with a 69-tick tape (every grid tick from t_lo - 66 ms to t_hi + 66 ms), in this order:
    /// BTC A (1 bet), B (3), C (10), E (1, volatile); MON F (1), G (3), H (1, volatile). Tapes are a fixed random walk
    /// from the market's price: typical +-0.4 band per tick, volatile +-2.5 bands (half of maxMoveE8).
    function settle() external {
        _load();
        uint32 k0 = uint32(vm.parseJsonUint(vm.readFile(string.concat("deployments/gasbench-", vm.toString(block.chainid), ".json")), ".k0"));
        (Mkt memory b, Mkt memory m) = (_btc(), _mon());
        address[] memory a3 = new address[](3);
        for (uint256 i; i < 3; ++i) a3[i] = p[i + 1].addr;
        address[] memory a10 = new address[](NP);
        for (uint256 i; i < NP; ++i) a10[i] = p[i].addr;
        vm.startBroadcast(vm.envAddress("HEXIT_KEEPER"));
        _settle(_settleCalldata(b, k0, _one(p[0].addr), 4));
        _settle(_settleCalldata(b, k0 + 1, a3, 4));
        _settle(_settleCalldata(b, k0 + 2, a10, 4));
        _settle(_settleCalldata(b, k0 + 4, _one(p[7].addr), 25));
        _settle(_settleCalldata(m, k0 + 5, _one(p[0].addr), 4));
        _settle(_settleCalldata(m, k0 + 6, a3, 4));
        _settle(_settleCalldata(m, k0 + 7, _one(p[8].addr), 25));
        vm.stopBroadcast();
        string memory path = string.concat("deployments/gasbench-", vm.toString(block.chainid), ".json");
        vm.writeJson(vm.toString(_settleCalldata(b, k0 + 3, _one(p[5].addr), 4)), path, ".settleCalldata");
    }

    function _one(address a) internal pure returns (address[] memory r) { r = new address[](1); r[0] = a; }

    function _settle(bytes memory cd) internal {
        (bool ok,) = address(game).call(cd);
        require(ok, "settle");
    }

    /// amp10 = random-walk amplitude per tick in tenths of a band.
    function _settleCalldata(Mkt memory m, uint32 k, address[] memory who, uint256 amp10) internal view returns (bytes memory) {
        (uint64[] memory ts, uint64[] memory px) = _tape(m, k, m.row * amp10 / 10);
        bytes memory buf;
        for (uint256 i; i < ts.length; ++i) buf = abi.encodePacked(buf, ts[i], px[i]);
        bytes memory sig = _sig(recorder.privateKey, keccak256(abi.encode(TAPE_T, m.asset, k, keccak256(buf))));
        return abi.encodeCall(HexitGame.settleColumn, (m.asset, k, ts, px, sig, who));
    }

    function _tape(Mkt memory m, uint32 k, uint256 amp) internal pure returns (uint64[] memory ts, uint64[] memory px) {
        ts = new uint64[](69);
        px = new uint64[](69);
        uint256 price = m.price;
        for (uint256 i; i < 69; ++i) {
            price = price + (uint256(keccak256(abi.encode("hexit.bench", i))) % (2 * amp + 1)) - amp;
            ts[i] = uint64(uint256(5000) * k - 900 + 100 * i);
            px[i] = uint64(price);
        }
    }

    /// Relayer: withdrawFor then depositFor (EIP-2612 permit + Deposit) for p0, on its next two nonces.
    function money() external {
        _load();
        address relayer = game.getParams().relayer;
        Vm.Wallet memory w = p[0];
        (,, uint48 n,,,,) = game.playerOf(w.addr);
        uint64 dl = uint64(block.timestamp + 120);
        bytes memory ws = _sig(w.privateKey, keccak256(abi.encode(WITHDRAW_T, w.addr, uint64(10e6), uint64(n), dl)));
        bytes memory ds = _sig(w.privateKey, keccak256(abi.encode(DEPOSIT_T, w.addr, uint64(5e6), uint64(n + 1), dl)));
        bytes32 ph = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            w.addr, address(game), uint256(5e6), usdc.nonces(w.addr), uint256(dl)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), ph)));
        vm.startBroadcast(relayer);
        game.withdrawFor(w.addr, 10e6, n, dl, ws);
        game.depositFor(w.addr, 5e6, n + 1, dl, ds, v, r, s);
        vm.stopBroadcast();
        (uint64 credit,,,,,,) = game.playerOf(w.addr);
        console.log("p0 credit", credit);
    }
}
