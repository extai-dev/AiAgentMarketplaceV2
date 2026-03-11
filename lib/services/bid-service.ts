/**
 * Bid Service Module
 * 
 * Handles bid operations:
 * - submitBid: Agent submits a bid on a task
 * - evaluateBids: Evaluate bids based on criteria
 * - selectWinningBid: Select the winning bid and assign task
 */

import { db } from '@/lib/db';
import { BidStatus } from '@prisma/client';
import { assignTask, startTaskExecution } from './task-service';
import { createEscrow } from './escrow-service';
import { notifyBidAccepted } from './notification-service';

export interface SubmitBidParams {
  taskId: string;
  agentId: string;
  agentWallet: string;
  amount: number;
  message?: string;
  estimatedCompletionTime?: number;
  txHash?: string;
}

export interface EvaluateBidParams {
  bidId: string;
  criteria?: {
    price?: boolean;
    reputation?: boolean;
    completionRate?: boolean;
    historicalLatency?: boolean;
  };
}

export interface SelectWinningBidParams {
  taskId: string;
  bidId: string;
  createEscrow?: boolean;
  escrowAmount?: number;
}

/**
 * Submit a bid on a task
 */
export async function submitBid(params: SubmitBidParams): Promise<{
  success: boolean;
  bid?: any;
  error?: string;
}> {
  try {
    // Verify task exists and is open for bidding
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Check if task is in a valid state for bidding
    const validStates = ['OPEN', 'BIDDING'];
    if (!validStates.includes(task.status)) {
      return { success: false, error: `Task is not open for bidding, current status: ${task.status}` };
    }

    // Check if agent is the creator
    if (task.creatorId === params.agentId) {
      return { success: false, error: 'Cannot bid on your own task' };
    }

    // Check if agent already has a pending bid
    const existingBid = await db.bid.findFirst({
      where: {
        taskId: params.taskId,
        agentId: params.agentId,
        status: BidStatus.PENDING,
      },
    });

    if (existingBid) {
      return { success: false, error: 'You already have a pending bid on this task' };
    }

    // Create the bid
    const bid = await db.bid.create({
      data: {
        taskId: params.taskId,
        agentId: params.agentId,
        amount: params.amount,
        message: params.message,
        txHash: params.txHash,
        status: BidStatus.PENDING,
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
    });

    // Update agent's bid count
    await db.agent.update({
      where: { id: params.agentId },
      data: { totalBids: { increment: 1 } },
    });

    // Update task status to BIDDING if still OPEN
    if (task.status === 'OPEN') {
      await db.task.update({
        where: { id: params.taskId },
        data: { status: 'BIDDING' },
      });
    }

    return { success: true, bid };
  } catch (error) {
    console.error('Error submitting bid:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to submit bid' };
  }
}

/**
 * Get all bids for a task
 */
export async function getTaskBids(taskId: string): Promise<{
  success: boolean;
  bids?: any[];
  error?: string;
}> {
  try {
    const bids = await db.bid.findMany({
      where: { taskId },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, bids };
  } catch (error) {
    console.error('Error fetching bids:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch bids' };
  }
}

/**
 * Get bid by ID
 */
export async function getBidById(bidId: string): Promise<{
  success: boolean;
  bid?: any;
  error?: string;
}> {
  try {
    const bid = await db.bid.findUnique({
      where: { id: bidId },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
        task: {
          select: {
            id: true,
            title: true,
            numericId: true,
            reward: true,
          },
        },
      },
    });

    if (!bid) {
      return { success: false, error: 'Bid not found' };
    }

    return { success: true, bid };
  } catch (error) {
    console.error('Error fetching bid:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch bid' };
  }
}

/**
 * Evaluate a single bid
 */
export async function evaluateBid(bidId: string): Promise<{
  success: boolean;
  evaluation?: {
    score: number;
    factors: {
      priceScore: number;
      reputationScore: number;
      completionScore: number;
      latencyScore: number;
    };
    error?: string;
  };
}> {
  try {
    const bid = await db.bid.findUnique({
      where: { id: bidId },
      include: {
        user: true,
        task: true,
      },
    });

    if (!bid) {
      return { success: false, error: 'Bid not found' };
    }

    // Get agent reputation
    const agent = await db.agent.findUnique({
      where: { id: bid.agentId },
    });

    // Calculate scores (0-100 scale)
    
    // Price score: lower price is better
    const priceScore = Math.max(0, 100 - (bid.amount / bid.task.reward) * 100);
    
    // Reputation score based on average rating
    const reputationScore = agent ? (agent.averageRating * 20) : 50;
    
    // Completion rate score
    const completionScore = agent && agent.totalTasks > 0
      ? (agent.completedTasks / agent.totalTasks) * 100
      : 50;
    
    // Latency score (placeholder - would need historical data)
    const latencyScore = 75;

    // Weighted average
    const score = Math.round(
      priceScore * 0.3 +
      reputationScore * 0.3 +
      completionScore * 0.25 +
      latencyScore * 0.15
    );

    return {
      success: true,
      evaluation: {
        score,
        factors: {
          priceScore,
          reputationScore,
          completionScore,
          latencyScore,
        },
      },
    };
  } catch (error) {
    console.error('Error evaluating bid:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to evaluate bid' };
  }
}

/**
 * Evaluate all bids for a task and rank them
 */
export async function evaluateBids(taskId: string): Promise<{
  success: boolean;
  rankings?: Array<{
    bidId: string;
    agentId: string;
    amount: number;
    score: number;
  }>;
  error?: string;
}> {
  try {
    const bids = await db.bid.findMany({
      where: {
        taskId,
        status: BidStatus.PENDING,
      },
    });

    const rankings = await Promise.all(
      bids.map(async (bid) => {
        const evaluation = await evaluateBid(bid.id);
        return {
          bidId: bid.id,
          agentId: bid.agentId,
          amount: bid.amount,
          score: evaluation.evaluation?.score || 0,
        };
      })
    );

    // Sort by score (descending)
    rankings.sort((a, b) => b.score - a.score);

    return { success: true, rankings };
  } catch (error) {
    console.error('Error evaluating bids:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to evaluate bids' };
  }
}

/**
 * Select winning bid and assign task
 */
export async function selectWinningBid(params: SelectWinningBidParams): Promise<{
  success: boolean;
  task?: any;
  bid?: any;
  escrow?: any;
  error?: string;
}> {
  try {
    const bid = await db.bid.findUnique({
      where: { id: params.bidId },
    });

    if (!bid) {
      return { success: false, error: 'Bid not found' };
    }

    if (bid.status !== BidStatus.PENDING) {
      return { success: false, error: 'Bid is not pending' };
    }

    // Get agent wallet address
    const agent = await db.agent.findUnique({
      where: { id: bid.agentId },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // Accept the bid
    const updatedBid = await db.bid.update({
      where: { id: params.bidId },
      data: { status: BidStatus.ACCEPTED },
    });

    // Reject all other pending bids
    await db.bid.updateMany({
      where: {
        taskId: params.taskId,
        id: { not: params.bidId },
        status: BidStatus.PENDING,
      },
      data: { status: BidStatus.REJECTED },
    });

    // Create escrow if requested
    let escrow = null;
    if (params.createEscrow && params.escrowAmount) {
      const task = await db.task.findUnique({
        where: { id: params.taskId },
      });

      if (task) {
        const escrowResult = await createEscrow({
          taskId: params.taskId,
          payer: task.creatorId,
          agentWallet: agent.walletAddress,
          amount: params.escrowAmount,
        });

        if (escrowResult.success && escrowResult.escrow) {
          escrow = escrowResult.escrow;
        }
      }
    }

    // Assign task to agent
    const taskResult = await assignTask({
      taskId: params.taskId,
      agentId: bid.agentId,
      agentWallet: agent.walletAddress,
      escrowAmount: params.escrowAmount,
    });

    if (!taskResult.success) {
      return { success: false, error: taskResult.error };
    }

    // Update agent's accepted bids count
    await db.agent.update({
      where: { id: bid.agentId },
      data: { acceptedBids: { increment: 1 } },
    });

    // Send notification
    await notifyBidAccepted(params.bidId);

    return {
      success: true,
      task: taskResult.task,
      bid: updatedBid,
      escrow,
    };
  } catch (error) {
    console.error('Error selecting winning bid:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to select winning bid' };
  }
}

/**
 * Reject a bid
 */
export async function rejectBid(bidId: string): Promise<{
  success: boolean;
  bid?: any;
  error?: string;
}> {
  try {
    const bid = await db.bid.findUnique({
      where: { id: bidId },
    });

    if (!bid) {
      return { success: false, error: 'Bid not found' };
    }

    if (bid.status !== BidStatus.PENDING) {
      return { success: false, error: 'Bid is not pending' };
    }

    const updatedBid = await db.bid.update({
      where: { id: bidId },
      data: { status: BidStatus.REJECTED },
    });

    return { success: true, bid: updatedBid };
  } catch (error) {
    console.error('Error rejecting bid:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to reject bid' };
  }
}

/**
 * Withdraw a bid (by the agent)
 */
export async function withdrawBid(bidId: string): Promise<{
  success: boolean;
  bid?: any;
  error?: string;
}> {
  try {
    const bid = await db.bid.findUnique({
      where: { id: bidId },
    });

    if (!bid) {
      return { success: false, error: 'Bid not found' };
    }

    if (bid.status !== BidStatus.PENDING) {
      return { success: false, error: 'Can only withdraw pending bids' };
    }

    const updatedBid = await db.bid.update({
      where: { id: bidId },
      data: { status: BidStatus.WITHDRAWN },
    });

    return { success: true, bid: updatedBid };
  } catch (error) {
    console.error('Error withdrawing bid:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to withdraw bid' };
  }
}
