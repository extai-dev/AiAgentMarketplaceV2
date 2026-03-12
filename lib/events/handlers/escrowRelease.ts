/**
 * Escrow Release Handler
 * 
 * Handles validation completion to release or refund escrow
 */

import { on } from '../eventBus';
import { EVENTS, TaskValidationCompletedEvent, EscrowReleasedEvent, EscrowRefundedEvent } from '../events';
import { db } from '@/lib/db';
import { EscrowStatus } from '@prisma/client';

/**
 * Handle task validation completed - release or refund escrow
 */
export async function handleValidationCompleted(payload: TaskValidationCompletedEvent): Promise<void> {
  console.log(`[EscrowRelease] Handling validation completed for task ${payload.taskId}, passed: ${payload.passed}`);

  try {
    const task = await db.task.findUnique({
      where: { id: payload.taskId },
      include: {
        escrow: true,
        agent: true,
      },
    });

    if (!task || !task.escrow) {
      console.log(`[EscrowRelease] No escrow found for task ${payload.taskId}`);
      return;
    }

    const escrow = task.escrow;

    // Check if escrow is in correct state
    if (escrow.status !== EscrowStatus.LOCKED) {
      console.log(`[EscrowRelease] Escrow not locked, current status: ${escrow.status}`);
      return;
    }

    if (payload.passed) {
      // Release escrow to agent
      await releaseEscrow(escrow.id, task.agentId || '', payload.taskId);
    } else {
      // Refund escrow to payer
      await refundEscrow(escrow.id, payload.taskId, `Validation failed with score ${payload.score}`);
    }
  } catch (error) {
    console.error('[EscrowRelease] Error handling validation completed:', error);
  }
}

/**
 * Release escrow funds to agent
 */
async function releaseEscrow(escrowId: string, agentId: string, taskId: string): Promise<void> {
  try {
    const escrow = await db.escrow.update({
      where: { id: escrowId },
      data: {
        status: EscrowStatus.RELEASED,
        releasedAt: new Date(),
      },
    });

    // Emit ESCROW_RELEASED event
    const event: EscrowReleasedEvent = {
      escrowId: escrow.id,
      taskId,
      agentId,
      amount: escrow.amount,
    };
    
    console.log(`[EscrowRelease] Released ${escrow.amount} to agent ${agentId}`);
  } catch (error) {
    console.error('[EscrowRelease] Error releasing escrow:', error);
  }
}

/**
 * Refund escrow funds to payer
 */
async function refundEscrow(escrowId: string, taskId: string, reason?: string): Promise<void> {
  try {
    const escrow = await db.escrow.update({
      where: { id: escrowId },
      data: {
        status: EscrowStatus.REFUNDED,
        refundedAt: new Date(),
      },
    });

    // Emit ESCROW_REFUNDED event
    const event: EscrowRefundedEvent = {
      escrowId: escrow.id,
      taskId,
      reason,
    };
    
    console.log(`[EscrowRelease] Refunded ${escrow.amount} to payer`);
  } catch (error) {
    console.error('[EscrowRelease] Error refunding escrow:', error);
  }
}

/**
 * Register event handlers
 */
export function registerEscrowReleaseHandlers(): void {
  on<TaskValidationCompletedEvent>(EVENTS.TASK_VALIDATION_COMPLETED, handleValidationCompleted);
  console.log('[EscrowRelease] Registered handlers');
}
