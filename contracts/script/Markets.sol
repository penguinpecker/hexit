// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Vm} from "forge-std/Vm.sol";
import {HexitGame} from "../src/HexitGame.sol";

/// The markets that the markets upgrade (Upgrade.s.sol) and a fresh deploy (Deploy.s.sol) open. These are placeholders
/// until the pricing research tunes them. The owner retunes them on chain with setMarket; a row change needs the market
/// to have no open bets.
/// Spot prices on 2026-10-10 (CoinGecko): BTC $82,385, MON $0.02436. Live since 2026-10-10 (owner: more line movement):
/// bands $5 and $0.00001 (one MON venue step); the tape move limits stay in price ($125, $0.00015 per 100 ms). Each
/// market's cap is half of params.maxMarketLiab, which still caps both together.
function hexitMarkets() pure returns (uint8[] memory ids, HexitGame.MarketConfig[] memory cfgs) {
    ids = new uint8[](2);
    cfgs = new HexitGame.MarketConfig[](2);
    ids[0] = 1;                                                                // BTC/USD: band $5 (0.006 % of price)
    cfgs[0] = HexitGame.MarketConfig(500_000_000, 12_500_000_000, 50_000_000_000, true);
    ids[1] = 3;                                                                // MON/USD: band $0.00001 (0.04 % of price)
    cfgs[1] = HexitGame.MarketConfig(1_000, 15_000, 50_000_000_000, true);
}

Vm constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

/// The deployment record's "markets" object, read from the chain: {"<asset id>": {rowE8, maxMoveE8, maxLiab (decimal
/// strings), enabled}} for every market hexitMarkets() lists.
function marketsJson(HexitGame game) returns (string memory out) {
    (uint8[] memory ids,) = hexitMarkets();
    for (uint256 i; i < ids.length; ++i) {
        (int64 row, uint56 move, bool on, uint64 cap,) = game.markets(ids[i]);
        string memory m = string.concat("hexit.market.", VM.toString(ids[i]));
        VM.serializeString(m, "rowE8", VM.toString(int256(row)));
        VM.serializeString(m, "maxMoveE8", VM.toString(uint256(move)));
        VM.serializeString(m, "maxLiab", VM.toString(cap));
        m = VM.serializeBool(m, "enabled", on);
        out = VM.serializeString("hexit.markets", VM.toString(ids[i]), m);
    }
}
