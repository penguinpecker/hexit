// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script, console} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {hexitMarkets, marketsJson} from "./Markets.sol";

/// Deploys TestUSDC and HexitGame behind ERC1967 (UUPS) proxies, opens the markets (initializeMarkets), makes the game
/// the tUSDC minter, funds the house with 10,000,000 tUSDC and writes the public deployment record (shape in README.md).
/// The live testnet proxy was deployed before markets existed and moves to them with Upgrade.s.sol instead.
///
/// Env: HEXIT_ADMIN, HEXIT_GUARDIAN, HEXIT_RECORDER, HEXIT_QUOTER, HEXIT_KEEPER, HEXIT_RELAYER (addresses).
/// Optional: HEXIT_KEY_ADMIN (sealed key; its address must equal HEXIT_ADMIN), otherwise the forge sender
/// (--account / --unlocked --sender) must be HEXIT_ADMIN; HEXIT_DEPLOY_OUT (default deployments/<chainId>.json);
/// HEXIT_RPC_HTTP / HEXIT_RPC_WS (recorded only); HEXIT_LABEL (archives out/build-info to deployments/build-info-<label>).
contract Deploy is Script {
    int64 constant ROW = 5_000_000;                  // asset 0 (SOL) band, $0.05: closed to bets, kept for upgrade parity
    uint64 constant HOUSE = 10_000_000e6;

    function params() public view returns (HexitGame.Params memory p) {
        p.recorders = [vm.envAddress("HEXIT_RECORDER"), address(0), address(0)];
        p.quoter = vm.envAddress("HEXIT_QUOTER");
        p.guardian = vm.envAddress("HEXIT_GUARDIAN");
        p.relayer = vm.envAddress("HEXIT_RELAYER");
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

    function run() external returns (HexitGame game, TestUSDC usdc) {
        address admin = vm.envAddress("HEXIT_ADMIN");
        HexitGame.Params memory p = params();
        uint256 deployBlock = block.number;
        uint256 pk = vm.envOr("HEXIT_KEY_ADMIN", uint256(0));
        if (pk != 0) {
            require(vm.addr(pk) == admin, "HEXIT_KEY_ADMIN does not derive HEXIT_ADMIN");
            vm.startBroadcast(pk);
        } else {
            require(msg.sender == admin, "forge sender is not HEXIT_ADMIN");
            vm.startBroadcast();
        }
        address usdcImpl = address(new TestUSDC());
        usdc = TestUSDC(address(new ERC1967Proxy(usdcImpl, abi.encodeCall(TestUSDC.initialize, (admin)))));
        address gameImpl = address(new HexitGame());
        game = HexitGame(address(new ERC1967Proxy(gameImpl, abi.encodeCall(HexitGame.initialize, (admin, address(usdc), ROW, p)))));
        (uint8[] memory ids, HexitGame.MarketConfig[] memory cs) = hexitMarkets();
        game.initializeMarkets(ids, cs);
        usdc.setMinter(address(game), true);
        usdc.mint(admin, HOUSE);
        usdc.approve(address(game), HOUSE);
        game.houseDeposit(HOUSE);
        vm.stopBroadcast();

        string memory label = vm.envOr("HEXIT_LABEL", string(""));
        if (bytes(label).length != 0) _archiveBuildInfo(label);
        _write(game, gameImpl, usdc, usdcImpl, p, deployBlock, label);
    }

    function _archiveBuildInfo(string memory label) internal {
        string memory dir = string.concat("deployments/build-info-", label);
        vm.createDir(dir, true);
        Vm.DirEntry[] memory files = vm.readDir("out/build-info");
        for (uint256 i; i < files.length; ++i) {
            if (files[i].isDir) continue;
            string[] memory parts = vm.split(files[i].path, "/");
            vm.copyFile(files[i].path, string.concat(dir, "/", parts[parts.length - 1]));
        }
    }

    function _write(HexitGame game, address gameImpl, TestUSDC usdc, address usdcImpl, HexitGame.Params memory p, uint256 deployBlock, string memory label) internal {
        string memory roles = "roles";
        vm.serializeAddress(roles, "admin", vm.envAddress("HEXIT_ADMIN"));
        vm.serializeAddress(roles, "guardian", p.guardian);
        vm.serializeAddress(roles, "recorder", p.recorders[0]);
        vm.serializeAddress(roles, "quoter", p.quoter);
        vm.serializeAddress(roles, "keeper", vm.envAddress("HEXIT_KEEPER"));
        roles = vm.serializeAddress(roles, "relayer", p.relayer);

        string memory ps = "params";
        vm.serializeString(ps, "minStake", vm.toString(p.minStake));
        vm.serializeString(ps, "maxStake", vm.toString(p.maxStake));
        vm.serializeString(ps, "maxPayout", vm.toString(p.maxPayout));
        vm.serializeString(ps, "maxHexLiab", vm.toString(p.maxHexLiab));
        vm.serializeString(ps, "maxColLiab", vm.toString(p.maxColLiab));
        vm.serializeString(ps, "maxMarketLiab", vm.toString(p.maxMarketLiab));
        vm.serializeString(ps, "dailyLossLimit", vm.toString(p.dailyLossLimit));
        vm.serializeString(ps, "maxMoveE8", vm.toString(p.maxMoveE8));
        vm.serializeUint(ps, "voidAfterMs", p.voidAfterMs);
        vm.serializeUint(ps, "gapMs", p.gapMs);
        vm.serializeUint(ps, "quoteMaxAgeMs", p.quoteMaxAgeMs);
        vm.serializeUint(ps, "lockMarginMs", p.lockMarginMs);
        vm.serializeUint(ps, "maxOpen", p.maxOpen);
        ps = vm.serializeString(ps, "grant", vm.toString(game.GRANT()));

        string memory mk = marketsJson(game);

        string memory rpc = "rpc";
        vm.serializeString(rpc, "http", vm.envOr("HEXIT_RPC_HTTP", string("https://testnet-rpc.monad.xyz")));
        rpc = vm.serializeString(rpc, "ws", vm.envOr("HEXIT_RPC_WS", string("wss://testnet-rpc.monad.xyz")));

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeString(o, "rpc", rpc);
        vm.serializeAddress(o, "game", address(game));
        vm.serializeAddress(o, "gameImpl", gameImpl);
        vm.serializeAddress(o, "usdc", address(usdc));
        vm.serializeAddress(o, "usdcImpl", usdcImpl);
        vm.serializeString(o, "roles", roles);
        vm.serializeUint(o, "deployBlock", deployBlock);
        vm.serializeString(o, "params", ps);
        vm.serializeString(o, "markets", mk);
        vm.serializeString(o, "broadcast", string.concat("contracts/broadcast/Deploy.s.sol/", vm.toString(block.chainid), "/run-latest.json"));
        o = vm.serializeString(o, "buildInfo", bytes(label).length == 0 ? "" : string.concat("contracts/deployments/build-info-", label));

        string memory out = vm.envOr("HEXIT_DEPLOY_OUT", string.concat("deployments/", vm.toString(block.chainid), ".json"));
        vm.createDir("deployments", true);
        vm.writeJson(o, out);
        console.log("game ", address(game));
        console.log("usdc ", address(usdc));
        console.log("wrote", out);
    }
}
