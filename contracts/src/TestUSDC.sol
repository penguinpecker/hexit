// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// Hexit test USDC: 6 decimals, EIP-2612 permit (domain "Hexit Test USDC", "1"), minted only by the owner or an
/// owner-approved minter (the HexitGame proxy). Play money with no value.
contract TestUSDC is ERC20Upgradeable, ERC20PermitUpgradeable, Ownable2StepUpgradeable, UUPSUpgradeable {
    mapping(address => bool) public minters;
    uint256[49] private __gap;

    error NotMinter();
    event MinterSet(address indexed minter, bool on);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address owner_) external initializer {
        __ERC20_init("Hexit Test USDC", "tUSDC");
        __ERC20Permit_init("Hexit Test USDC");
        __Ownable_init(owner_);
    }

    function decimals() public pure override returns (uint8) { return 6; }

    function setMinter(address m, bool on) external onlyOwner { minters[m] = on; emit MinterSet(m, on); }

    function mint(address to, uint256 amount) external {
        if (!minters[msg.sender] && msg.sender != owner()) revert NotMinter();
        _mint(to, amount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
