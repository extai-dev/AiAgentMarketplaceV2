// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    IERC20 public immutable paymentToken;
    
    // Task ID => Escrow info
    mapping(uint256 => Escrow) public escrows;
    
    // Task ID counter (managed off-chain, just used for tracking)
    uint256 public nextEscrowId;

    // ============ Structs ============

    struct Escrow {
        uint256 amount;        // Amount deposited
        address creator;       // Who deposited
        address agent;         // Who will receive payment (set on release)
        bool exists;           // Whether escrow exists
        bool released;         // Whether escrow has been released
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
        if (escrows[_taskId].exists) revert EscrowAlreadyExists();
        
        escrows[_taskId] = Escrow({
            amount: _amount,
            creator: msg.sender,
            agent: address(0),
            exists: true,
            released: false
        });

        paymentToken.safeTransferFrom(msg.sender, address(this), _amount);

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
        
        if (!escrow.exists) revert EscrowNotExists();
        if (escrow.released) revert EscrowAlreadyReleased();
        if (escrow.creator != msg.sender) revert NotEscrowCreator();
        if (_agent == address(0)) revert InvalidAgent();

        escrow.released = true;
        escrow.agent = _agent;

        uint256 amount = escrow.amount;
        paymentToken.safeTransfer(_agent, amount);

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
        
        if (!escrow.exists) revert EscrowNotExists();
        if (escrow.released) revert EscrowAlreadyReleased();
        if (escrow.creator != msg.sender) revert NotEscrowCreator();

        escrow.released = true;

        uint256 amount = escrow.amount;
        paymentToken.safeTransfer(escrow.creator, amount);

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
        return (
            escrow.amount,
            escrow.creator,
            escrow.agent,
            escrow.exists,
            escrow.released
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
        Escrow storage escrow = escrows[_taskId];
        return escrow.exists && !escrow.released;
    }
}
