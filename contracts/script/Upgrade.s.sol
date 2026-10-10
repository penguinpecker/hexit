// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script, console} from "forge-std/Script.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {hexitMarkets, marketsJson} from "./Markets.sol";

/// The markets upgrade of a live HexitGame proxy, in two transactions from the admin: deploy the new implementation,
/// then upgradeToAndCall(impl, initializeMarkets(hexitMarkets())). After that, BTC (1) and MON (3) take bets and SOL
/// (0) takes none, but its open bets still settle or VOID.
///
/// run() (with --broadcast) sends both and checks forge's simulation; it writes nothing, because forge runs a script
/// locally before it broadcasts, and a refused broadcast must not leave a record naming an implementation that is not
/// live (security review L1). record() (no --broadcast) then reads the chain itself, checks the same things there and
/// only then writes "gameImpl" and "markets" into HEXIT_DEPLOY_OUT.
///
/// Env: HEXIT_GAME (the proxy). run(): HEXIT_ADMIN (its owner) and optionally HEXIT_KEY_ADMIN (a sealed key whose address
/// must equal HEXIT_ADMIN; otherwise the forge sender must be HEXIT_ADMIN). record(): HEXIT_DEPLOY_OUT.
contract Upgrade is Script {
    bytes32 constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external returns (address impl) {
        HexitGame game = HexitGame(vm.envAddress("HEXIT_GAME"));
        address admin = vm.envAddress("HEXIT_ADMIN");
        require(game.owner() == admin, "HEXIT_ADMIN does not own HEXIT_GAME");
        (uint8[] memory ids, HexitGame.MarketConfig[] memory cs) = hexitMarkets();
        uint256 open = game.openLiability();
        uint256 pk = vm.envOr("HEXIT_KEY_ADMIN", uint256(0));
        if (pk != 0) {
            require(vm.addr(pk) == admin, "HEXIT_KEY_ADMIN does not derive HEXIT_ADMIN");
            vm.startBroadcast(pk);
        } else {
            require(msg.sender == admin, "forge sender is not HEXIT_ADMIN");
            vm.startBroadcast();
        }
        impl = address(new HexitGame());
        game.upgradeToAndCall(impl, abi.encodeCall(HexitGame.initializeMarkets, (ids, cs)));
        vm.stopBroadcast();

        require(_impl(game) == impl, "implementation not switched");
        (,,,, uint64 solLiab) = game.markets(0);
        require(solLiab == open, "asset 0 did not take the open liability");
        _checkMarkets(game);
        console.log("impl ", impl);
        console.log("open SOL liability carried (VOID or settle with asset 0)", open);
        console.log("next: forge script script/Upgrade.s.sol --sig 'record()' --rpc-url <the same RPC> (no --broadcast)");
    }

    /// Against the live chain, after run()'s broadcast: the proxy runs a markets build (a pre-markets one has no
    /// markets(), so this reverts) with every market as hexitMarkets() lists it; then the record is written.
    function record() external {
        HexitGame game = HexitGame(vm.envAddress("HEXIT_GAME"));
        string memory out = vm.envString("HEXIT_DEPLOY_OUT");
        address impl = _impl(game);
        require(impl.code.length != 0, "no implementation code");
        _checkMarkets(game);
        vm.writeJson(string.concat('"', vm.toString(impl), '"'), out, ".gameImpl");
        vm.writeJson(marketsJson(game), out, ".markets");
        console.log("chain checked at block", block.number);
        console.log("impl ", impl);
        console.log("wrote", out);
    }

    function _impl(HexitGame game) internal view returns (address) {
        return address(uint160(uint256(vm.load(address(game), IMPL_SLOT))));
    }

    /// Asset 0 (SOL) keeps the pre-upgrade row and is closed; each listed market is set as listed.
    function _checkMarkets(HexitGame game) internal view {
        (int64 solRow,, bool solOn,,) = game.markets(0);
        require(solRow == game.rowE8() && !solOn, "asset 0 not carried over");
        (uint8[] memory ids, HexitGame.MarketConfig[] memory cs) = hexitMarkets();
        for (uint256 i; i < ids.length; ++i) {
            (int64 row, uint56 move, bool on, uint64 cap,) = game.markets(ids[i]);
            require(row == cs[i].rowE8 && move == cs[i].maxMoveE8 && cap == cs[i].maxLiab && on == cs[i].enabled, "market not set");
        }
    }
}
