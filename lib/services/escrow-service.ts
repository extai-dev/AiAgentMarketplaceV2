/**
 * Escrow Service Module
 * 
 * Handles escrow operations for task payments:
 * - createEscrow: Create new escrow when bid is accepted
 * - lockFunds: Move funds to locked state
 * - releaseFunds: Release funds to agent (on validation pass)
 * - refundFunds: Refund funds to payer (on validation fail or cancellation)
 * 
 * Integrates with ChaosChain for on-chain escrow operations
 */

import { db } from '@/lib/db';
import { EscrowStatus, ReleaseCondition } from '@prisma/client';
import { chaosChainService, CHAIN_CONFIG } from '@/lib/chaoschain-service';

export interface CreateEscrowParams {
  taskId: string;
  payer: string;
  agentWallet: string;
  amount: number;
  token?: string;
  tokenAddress?: string;
  releaseCondition?: ReleaseCondition;
}

export interface LockFundsParams {
  escrowId: string;
  txHash?: string;
}

export interface ReleaseFundsParams {
  escrowId: string;
  txHash?: string;
}

export interface RefundFundsParams {
  escrowId: string;
  reason?: string;
  txHash?: string;
}

/**
 * Create a new escrow for a task
 */
export async function createEscrow(params: CreateEscrowParams): Promise<{
  success: boolean;
  escrow?: any;
  error?: string;
}> {
  try {
    // Check if escrow already exists for this task
    const existing = await db.escrow.findUnique({
      where: { taskId: params.taskId },
    });

    if (existing) {
      return { success: false, error: 'Escrow already exists for this task' };
    }

    // Verify task exists
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    const escrow = await db.escrow.create({
      data: {
        taskId: params.taskId,
        payer: params.payer,
        agentWallet: params.agentWallet,
        amount: params.amount,
        token: params.token || 'USDC',
        tokenAddress: params.tokenAddress,
        status: EscrowStatus.PENDING,
        releaseCondition: params.releaseCondition || ReleaseCondition.VALIDATION_PASSED,
      },
    });

    return { success: true, escrow };
  } catch (error) {
    console.error('Error creating escrow:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create escrow' };
  }
}

/**
 * Lock funds in escrow (called when payment is received)
 */
export async function lockEscrowFunds(params: LockFundsParams): Promise<{
  success: boolean;
  escrow?: any;
  error?: string;
}> {
  try {
    const escrow = await db.escrow.findUnique({
      where: { id: params.escrowId },
    });

    if (!escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    if (escrow.status !== EscrowStatus.PENDING) {
      return { success: false, error: `Escrow is already ${escrow.status}` };
    }

    const updatedEscrow = await db.escrow.update({
      where: { id: params.escrowId },
      data: {
        status: EscrowStatus.LOCKED,
        txHash: params.txHash,
      },
    });

    // Update task escrow deposited flag
    await db.task.update({
      where: { id: escrow.taskId },
      data: { escrowDeposited: true },
    });

    return { success: true, escrow: updatedEscrow };
  } catch (error) {
    console.error('Error locking escrow funds:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to lock funds' };
  }
}

/**
 * Release funds to agent (validation passed)
 */
export async function releaseEscrowFunds(params: ReleaseFundsParams): Promise<{
  success: boolean;
  escrow?: any;
  error?: string;
}> {
  try {
    const escrow = await db.escrow.findUnique({
      where: { id: params.escrowId },
    });

    if (!escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    if (escrow.status !== EscrowStatus.LOCKED) {
      return { success: false, error: `Escrow is not locked, current status: ${escrow.status}` };
    }

    // Check release condition
    if (escrow.releaseCondition === ReleaseCondition.VALIDATION_PASSED) {
      // Validation should be done before calling this
      const workSubmission = await db.workSubmission.findUnique({
        where: { taskId: escrow.taskId },
      });

      if (!workSubmission || workSubmission.status !== 'APPROVED') {
        return { success: false, error: 'Validation not passed yet' };
      }
    }

    const updatedEscrow = await db.escrow.update({
      where: { id: params.escrowId },
      data: {
        status: EscrowStatus.RELEASED,
        txHash: params.txHash,
        releasedAt: new Date(),
      },
    });

    return { success: true, escrow: updatedEscrow };
  } catch (error) {
    console.error('Error releasing escrow funds:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to release funds' };
  }
}

/**
 * Refund funds to payer
 */
export async function refundEscrowFunds(params: RefundFundsParams): Promise<{
  success: boolean;
  escrow?: any;
  error?: string;
}> {
  try {
    const escrow = await db.escrow.findUnique({
      where: { id: params.escrowId },
    });

    if (!escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    if (escrow.status === EscrowStatus.RELEASED) {
      return { success: false, error: 'Funds already released' };
    }

    if (escrow.status === EscrowStatus.REFUNDED) {
      return { success: false, error: 'Funds already refunded' };
    }

    const updatedEscrow = await db.escrow.update({
      where: { id: params.escrowId },
      data: {
        status: EscrowStatus.REFUNDED,
        txHash: params.txHash,
        refundedAt: new Date(),
      },
    });

    // Update task status if needed
    await db.task.update({
      where: { id: escrow.taskId },
      data: { status: 'FAILED' },
    });

    return { success: true, escrow: updatedEscrow };
  } catch (error) {
    console.error('Error refunding escrow funds:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to refund funds' };
  }
}

/**
 * Get escrow by task ID
 */
export async function getEscrowByTaskId(taskId: string): Promise<{
  success: boolean;
  escrow?: any;
  error?: string;
}> {
  try {
    const escrow = await db.escrow.findUnique({
      where: { taskId },
    });

    if (!escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    return { success: true, escrow };
  } catch (error) {
    console.error('Error fetching escrow:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch escrow' };
  }
}

/**
 * Get escrow by ID
 */
export async function getEscrowById(escrowId: string): Promise<{
  success: boolean;
  escrow?: any;
  error?: string;
}> {
  try {
    const escrow = await db.escrow.findUnique({
      where: { id: escrowId },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            numericId: true,
          },
        },
      },
    });

    if (!escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    return { success: true, escrow };
  } catch (error) {
    console.error('Error fetching escrow:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch escrow' };
  }
}

/**
 * Handle dispute - put escrow in dispute state
 */
export async function disputeEscrow(escrowId: string): Promise<{
  success: boolean;
  escrow?: any;
  error?: string;
}> {
  try {
    const escrow = await db.escrow.findUnique({
      where: { id: escrowId },
    });

    if (!escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    const updatedEscrow = await db.escrow.update({
      where: { id: escrowId },
      data: {
        status: EscrowStatus.DISPUTED,
      },
    });

    // Update task to disputed
    await db.task.update({
      where: { id: escrow.taskId },
      data: { status: 'DISPUTED' },
    });

    return { success: true, escrow: updatedEscrow };
  } catch (error) {
    console.error('Error disputing escrow:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to dispute escrow' };
  }
}
