// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @dev Simple ERC-20 token for testing payments in the Task Marketplace
 */
contract MockERC20 is ERC20, Ownable {
    uint8 private constant DECIMALS = 18;
    
    constructor() ERC20("TaskToken", "TT") Ownable(msg.sender) {
        // Mint 1,000,000 tokens to deployer for testing
        _mint(msg.sender, 1000000 * 10 ** DECIMALS);
    }

    /**
     * @dev Mint tokens (owner only) - for testing
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Get token decimals
     */
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }
}
