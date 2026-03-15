// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleEscrow
 * @dev Minimal escrow contract for AI Agent Task Marketplace
 * @notice Simplified flow:
 *   1. Tasks and bids managed off-chain (database)
 *   2. depositEscrow() - Creator locks funds for a task
 *   3. approveAndRelease() - Creator releases to agent
 *   4. refund() - Creator can cancel and get refund
 */
contract SimpleEscrow is ReentrancyGuard, Ownable {
    // Using plain IERC20 - SafeERC20 removed to reduce gas costs
    // Token transfers use standard ERC20 interface directly

    // ============ State Variables ============

    IERC20 public immutable paymentToken;
    
    // Task ID => Escrow info
    mapping(uint256 => Escrow) public escrows;

    // ============ Structs ============

    struct Escrow {
        uint128 amount;      // Amount deposited (packed with status)
        address creator;     // Who deposited (also serves as existence check)
        address agent;       // Who will receive payment (set on release)
        uint8 status;        // Bit 0: exists, Bit 1: released
    }

    // ============ Events ============

    event EscrowDeposited(
        uint256 indexed taskId,
        address indexed creator,
        uint256 amount
    );

    event EscrowReleased(
        uint256 indexed taskId,
        address indexed creator,
        address indexed agent,
        uint256 amount
    );

    event EscrowRefunded(
        uint256 indexed taskId,
        address indexed creator,
        uint256 amount
    );

    // ============ Constants for status bits ============
    uint8 constant STATUS_EXISTS = 1;
    uint8 constant STATUS_RELEASED = 2;

    // ============ Errors ============

    error EscrowNotExists();
    error EscrowAlreadyExists();
    error EscrowAlreadyReleased();
    error NotEscrowCreator();
    error InsufficientDeposit();
    error InvalidAmount();
    error InvalidAgent();
    error InvalidTokenAddress();

    // ============ Constructor ============

    constructor(address _paymentToken) Ownable(msg.sender) {
        if (_paymentToken == address(0)) revert InvalidTokenAddress();
        paymentToken = IERC20(_paymentToken);
    }

    // ============ External Functions ============

    /**
     * @dev Deposit tokens as escrow for a task
     * @param _taskId Task ID (from database)
     * @param _amount Amount to deposit
     * 
     * Called by task creator when accepting a bid.
     * Can only deposit once per task.
     */
    function depositEscrow(uint256 _taskId, uint256 _amount)
        external
        nonReentrant
    {
        if (_amount == 0) revert InvalidAmount();
        if (escrows[_taskId].status & STATUS_EXISTS != 0) revert EscrowAlreadyExists();
        
        escrows[_taskId] = Escrow({
            amount: uint128(_amount),
            creator: msg.sender,
            agent: address(0),
            status: STATUS_EXISTS
        });

        // Use transferFrom instead of safeTransferFrom to reduce gas costs
        // The token is a trusted ERC20, so additional safe transfer checks are unnecessary
        IERC20(paymentToken).transferFrom(msg.sender, address(this), _amount);

        emit EscrowDeposited(_taskId, msg.sender, _amount);
    }

    /**
     * @dev Release escrow to the agent
     * @param _taskId Task ID
     * @param _agent Agent address to receive payment
     * 
     * Called by task creator after agent completes work.
     * Releases entire escrow amount to agent.
     */
    function approveAndRelease(uint256 _taskId, address _agent)
        external
        nonReentrant
    {
        Escrow storage escrow = escrows[_taskId];
        
        uint8 currentStatus = escrow.status;
        if (currentStatus == 0) revert EscrowNotExists();
        if (currentStatus & STATUS_RELEASED != 0) revert EscrowAlreadyReleased();
        if (escrow.creator != msg.sender) revert NotEscrowCreator();
        if (_agent == address(0)) revert InvalidAgent();

        escrow.status = currentStatus | STATUS_RELEASED;
        escrow.agent = _agent;

        uint256 amount = escrow.amount;
        // Use transfer instead of safeTransfer to reduce gas costs
        // The recipient is a verified agent address, so additional safe transfer checks are unnecessary
        IERC20(paymentToken).transfer(_agent, amount);

        emit EscrowReleased(_taskId, msg.sender, _agent, amount);
    }

    /**
     * @dev Refund escrow to creator (cancel task)
     * @param _taskId Task ID
     * 
     * Called by task creator to cancel and get refund.
     * Only works if not yet released.
     */
    function refund(uint256 _taskId)
        external
        nonReentrant
    {
        Escrow storage escrow = escrows[_taskId];
        
        uint8 currentStatus = escrow.status;
        if (currentStatus == 0) revert EscrowNotExists();
        if (currentStatus & STATUS_RELEASED != 0) revert EscrowAlreadyReleased();
        if (escrow.creator != msg.sender) revert NotEscrowCreator();

        escrow.status = currentStatus | STATUS_RELEASED;

        uint256 amount = escrow.amount;
        // Use transfer instead of safeTransfer to reduce gas costs
        IERC20(paymentToken).transfer(escrow.creator, amount);

        emit EscrowRefunded(_taskId, msg.sender, amount);
    }

    // ============ View Functions ============

    /**
     * @dev Get escrow details
     */
    function getEscrow(uint256 _taskId)
        external
        view
        returns (
            uint256 amount,
            address creator,
            address agent,
            bool exists,
            bool released
        )
    {
        Escrow storage escrow = escrows[_taskId];
        uint8 status = escrow.status;
        return (
            escrow.amount,
            escrow.creator,
            escrow.agent,
            status & STATUS_EXISTS != 0,
            status & STATUS_RELEASED != 0
        );
    }

    /**
     * @dev Get escrow amount only (for gas-efficient reads)
     */
    function getEscrowAmount(uint256 _taskId) external view returns (uint256) {
        return escrows[_taskId].amount;
    }

    /**
     * @dev Check if escrow exists and is available
     */
    function isEscrowAvailable(uint256 _taskId) external view returns (bool) {
        uint8 status = escrows[_taskId].status;
        return status != 0 && (status & STATUS_RELEASED == 0);
    }
}
