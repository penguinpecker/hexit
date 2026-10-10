// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {HexitGame} from "../src/HexitGame.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {Base} from "./Base.t.sol";

/// Test-only implementation for upgrade tests: one appended variable and an owner-guarded reinitializer.
contract UpgradeProbe is HexitGame {
    uint256 public probe;
    function reinit(uint256 v) external reinitializer(3) onlyOwner { probe = v; }
}

/// T-UUPS: re-init protection, locked implementations, owner-only upgrades that keep state, 2-step ownership,
/// TestUSDC minting rules. (OpenZeppelin upgrade-safety validation runs outside forge: `npm run validate`.)
contract UpgradeTest is Base {
    bytes32 constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function _impl(address proxy) internal view returns (address) { return address(uint160(uint256(vm.load(proxy, IMPL_SLOT)))); }
    function _notOwner(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, who);
    }

    function test_reinitialize_reverts() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        game.initialize(alice.addr, address(usdc), ROW, _params());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        usdc.initialize(alice.addr);
    }

    function test_implementations_locked() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        HexitGame(_impl(address(game))).initialize(alice.addr, address(usdc), ROW, _params());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        TestUSDC(_impl(address(usdc))).initialize(alice.addr);
        address next = address(new UpgradeProbe());
        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        HexitGame(_impl(address(game))).upgradeToAndCall(next, "");
    }

    function test_upgrade_owner_only_keeps_state() public {
        _grant(alice.addr);
        uint32 k = _openK();
        _bet(alice, k, 2400, 5e6, 0);
        address next = address(new UpgradeProbe());
        bytes memory init = abi.encodeCall(UpgradeProbe.reinit, (7));
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); game.upgradeToAndCall(next, init);
        vm.prank(guardian); vm.expectRevert(_notOwner(guardian)); game.upgradeToAndCall(next, init);
        vm.prank(owner); game.upgradeToAndCall(next, init);
        assertEq(_impl(address(game)), next);
        UpgradeProbe g = UpgradeProbe(address(game));
        assertEq(g.probe(), 7);
        assertEq(_credit(alice.addr), 95e6);
        assertEq(g.house(), HOUSE);
        assertEq(g.totalOpen(), 5e6);
        assertEq(abi.encode(g.getParams()), abi.encode(_params()));
        (int32 bJ0, uint8 state,, uint64 liab,) = g.columnOf(A, k);
        assertEq(bJ0, 2272);
        assertEq(state, 1);
        assertEq(liab, 10e6);
        assertEq(g.domainSeparator(), dom);                                       // signatures keep working
        vm.prank(owner); vm.expectRevert(Initializable.InvalidInitialization.selector); g.reinit(8);
        _bet(alice, k, 2401, 1e6, 1);                                             // play continues on the new code
        _assertTreasury();
    }

    /// A reinitializer left uncalled by upgradeToAndCall is still owner-only and single-use.
    function test_reinitializer_guarded() public {
        address next = address(new UpgradeProbe());
        vm.prank(owner); game.upgradeToAndCall(next, "");
        UpgradeProbe g = UpgradeProbe(address(game));
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); g.reinit(1);
        vm.prank(owner); g.reinit(2);
        vm.prank(owner); vm.expectRevert(Initializable.InvalidInitialization.selector); g.reinit(3);
        assertEq(g.probe(), 2);
    }

    function test_usdc_upgrade_owner_only() public {
        address next = address(new TestUSDC());
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); usdc.upgradeToAndCall(next, "");
        vm.prank(owner); usdc.upgradeToAndCall(next, "");
        assertEq(_impl(address(usdc)), next);
        assertEq(usdc.balanceOf(address(game)), HOUSE);
        assertTrue(usdc.minters(address(game)));
    }

    function test_ownership_two_step() public {
        vm.prank(owner); game.transferOwnership(alice.addr);
        assertEq(game.owner(), owner);                                            // pending only
        assertEq(game.pendingOwner(), alice.addr);
        vm.prank(bob.addr); vm.expectRevert(_notOwner(bob.addr)); game.acceptOwnership();
        vm.prank(alice.addr); game.acceptOwnership();
        assertEq(game.owner(), alice.addr);
        vm.prank(owner); vm.expectRevert(_notOwner(owner)); game.setParams(_params());
        address next = address(new UpgradeProbe());
        vm.prank(owner); vm.expectRevert(_notOwner(owner)); game.upgradeToAndCall(next, "");
    }

    function test_usdc_rules() public {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.name(), "Hexit Test USDC");
        assertEq(usdc.symbol(), "tUSDC");
        vm.prank(alice.addr); vm.expectRevert(TestUSDC.NotMinter.selector); usdc.mint(alice.addr, 1);
        vm.prank(alice.addr); vm.expectRevert(_notOwner(alice.addr)); usdc.setMinter(alice.addr, true);
        vm.prank(owner); usdc.setMinter(alice.addr, true);
        vm.prank(alice.addr); usdc.mint(alice.addr, 1);
        vm.prank(owner); usdc.setMinter(alice.addr, false);
        vm.prank(alice.addr); vm.expectRevert(TestUSDC.NotMinter.selector); usdc.mint(alice.addr, 1);
        vm.prank(owner); usdc.mint(bob.addr, 1);
        assertEq(usdc.balanceOf(alice.addr) + usdc.balanceOf(bob.addr), 2);
    }
}
