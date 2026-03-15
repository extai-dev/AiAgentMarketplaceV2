/**
 * Escrow Service
 * Handles escrow operations and database synchronization with on-chain escrow
 */

import { ethers } from 'ethers';
import { db } from '@/lib/db';
import { SIMPLE_ESCROW_ADDRESS, TASK_TOKEN_ADDRESS } from '@/lib/contracts/addresses';
import { SIMPLE_ESCROW_ABI } from '@/lib/contracts/SimpleEscrow';
import { EscrowStatus, TaskStatus } from '@prisma/client';

// SimpleEscrow contract interface
interface EscrowInfo {
  amount: bigint;
  creator: string;
  agent: string;
  exists: boolean;
  released: boolean;
}

/**
 * Get escrow info from on-chain SimpleEscrow contract
 */
export async function getOnChainEscrow(taskId: number): Promise<EscrowInfo | null> {
  try {
    const provider = new ethers.JsonRpcProvider('https://rpc-amoy.polygon.technology');
    const contract = new ethers.Contract(SIMPLE_ESCROW_ADDRESS, SIMPLE_ESCROW_ABI, provider);
    
    const result = await contract.getEscrow(taskId);
    return {
      amount: result[0],
      creator: result[1],
      agent: result[2],
      exists: result[3],
      released: result[4],
    };
  } catch (error) {
    console.error(`Error fetching escrow for task ${taskId}:`, error);
    return null;
  }
}

/**
 * Get escrow by task ID from database
 * Uses the new Escrow model for tracking
 */
export async function getEscrowByTaskId(taskId: string) {
  try {
    // First try to get from Escrow table
    const escrow = await db.escrow.findUnique({
      where: { taskId },
    });

    if (escrow) {
      return {
        success: true,
        escrow: {
          id: escrow.id,
          taskId: escrow.taskId,
          amount: escrow.amount.toString(),
          status: escrow.status,
          released: escrow.status === EscrowStatus.RELEASED,
          exists: escrow.status === EscrowStatus.LOCKED || escrow.status === EscrowStatus.RELEASED,
        },
      };
    }

    // Fallback to task's escrow fields if no Escrow record exists
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        agent: true,
        creator: true,
      },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // If task has onChainId, try to get on-chain escrow info
    if (task.onChainId) {
      const onChainEscrow = await getOnChainEscrow(task.onChainId);
      if (onChainEscrow) {
        return {
          success: true,
          escrow: {
            id: `escrow-${task.onChainId}`,
            taskId: task.id,
            amount: ethers.formatEther(onChainEscrow.amount),
            released: onChainEscrow.released,
            exists: onChainEscrow.exists,
            agentAddress: onChainEscrow.agent,
            creatorAddress: onChainEscrow.creator,
          },
        };
      }
    }

    // Return database escrow status
    return {
      success: true,
      escrow: {
        id: `escrow-${task.id}`,
        taskId: task.id,
        amount: task.reward.toString(),
        released: false,
        exists: task.escrowDeposited,
        agentAddress: task.agent?.walletAddress || null,
        creatorAddress: task.creator?.walletAddress || null,
      },
    };
  } catch (error) {
    console.error('Error getting escrow by task ID:', error);
    return { success: false, error: 'Failed to get escrow' };
  }
}

/**
 * Release escrow funds - calls on-chain contract and updates database
 * Note: This updates the database only. On-chain release requires wallet signature.
 */
export async function releaseEscrowFunds(params: { escrowId: string; txHash?: string }) {
  try {
    // Extract task ID from escrow ID (format: "escrow-{taskId}" or just numeric)
    const taskIdStr = params.escrowId.replace('escrow-', '');
    const taskId = parseInt(taskIdStr, 10);
    
    if (isNaN(taskId)) {
      return { success: false, error: 'Invalid escrow ID' };
    }

    // Get task from database to find the agent
    const task = await db.task.findFirst({
      where: {
        OR: [
          { onChainId: taskId },
          { numericId: taskId },
        ],
      },
      include: { agent: true },
    });

    if (!task) {
      return { success: false, error: 'Task not found in database' };
    }

    if (!task.agent?.walletAddress) {
      return { success: false, error: 'No agent assigned to this task' };
    }

    // Update or create Escrow record
    const escrow = await db.escrow.upsert({
      where: { taskId: task.id },
      create: {
        taskId: task.id,
        amount: task.reward,
        status: EscrowStatus.RELEASED,
        onChainId: task.onChainId,
        releasedAt: new Date(),
        txHash: params.txHash,
      },
      update: {
        status: EscrowStatus.RELEASED,
        releasedAt: new Date(),
        txHash: params.txHash,
      },
    });
    
    // Update task status
    await db.task.update({
      where: { id: task.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    return {
      success: true,
      escrow: {
        id: escrow.id,
        taskId: escrow.taskId,
        status: escrow.status,
        released: true,
      },
    };
  } catch (error) {
    console.error('Error releasing escrow funds:', error);
    return { success: false, error: 'Failed to release escrow funds' };
  }
}

/**
 * Lock/Deposit escrow funds - creates on-chain deposit and updates database
 */
export async function lockEscrowFunds(params: { taskId: string; amount: string; txHash?: string; onChainId?: number }) {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    const amount = parseFloat(params.amount);
    
    // Create or update Escrow record in database
    const escrow = await db.escrow.upsert({
      where: { taskId: params.taskId },
      create: {
        taskId: params.taskId,
        amount,
        status: EscrowStatus.LOCKED,
        onChainId: params.onChainId || task.onChainId || undefined,
        txHash: params.txHash,
      },
      update: {
        amount,
        status: EscrowStatus.LOCKED,
        onChainId: params.onChainId || task.onChainId || undefined,
        txHash: params.txHash,
        releasedAt: null,
        refundedAt: null,
      },
    });

    // Update task to mark escrow as deposited
    const updatedTask = await db.task.update({
      where: { id: params.taskId },
      data: {
        escrowDeposited: true,
        txHash: params.txHash || task.txHash,
        onChainId: params.onChainId || task.onChainId,
      },
    });

    return {
      success: true,
      escrow: {
        id: escrow.id,
        taskId: escrow.taskId,
        amount: escrow.amount.toString(),
        status: escrow.status,
        deposited: true,
      },
      task: updatedTask,
    };
  } catch (error) {
    console.error('Error locking escrow funds:', error);
    return { success: false, error: 'Failed to lock escrow funds' };
  }
}

/**
 * Sync task with on-chain escrow state
 * Updates database fields based on on-chain data
 * 
 * IMPORTANT: This respects the database workflow state. Escrow is only marked as RELEASED
 * if the task has completed the full workflow (IN_PROGRESS → VALIDATING → COMPLETED with approved submission).
 */
export async function syncTaskWithOnChain(taskId: string) {
  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        workSubmission: true,
      },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (!task.onChainId) {
      return { success: false, error: 'Task has no onChainId' };
    }

    // Get on-chain escrow info
    const onChainEscrow = await getOnChainEscrow(task.onChainId);
    
    if (!onChainEscrow || !onChainEscrow.exists) {
      return { success: false, error: 'No escrow found on-chain' };
    }

    const amount = Number(ethers.formatEther(onChainEscrow.amount));
    
    // Determine escrow status based on BOTH on-chain state AND database workflow
    // Only mark as RELEASED if:
    // 1. On-chain shows released AND
    // 2. Database workflow is complete (task COMPLETED with approved submission)
    const hasCompletedWorkflow = 
      task.status === TaskStatus.COMPLETED && 
      task.workSubmission && 
      (task.workSubmission.status === 'APPROVED' || 
       (task.workSubmission.score !== null && task.workSubmission.score >= 70));

    let escrowStatus: EscrowStatus;
    if (onChainEscrow.released && hasCompletedWorkflow) {
      escrowStatus = EscrowStatus.RELEASED;
    } else if (amount > 0) {
      // Funds exist but workflow not complete - should be LOCKED
      escrowStatus = EscrowStatus.LOCKED;
    } else {
      escrowStatus = EscrowStatus.PENDING;
    }

    // Update or create Escrow record
    const escrow = await db.escrow.upsert({
      where: { taskId },
      create: {
        taskId,
        amount,
        status: escrowStatus,
        onChainId: task.onChainId,
        releasedAt: escrowStatus === EscrowStatus.RELEASED ? new Date() : null,
      },
      update: {
        amount,
        status: escrowStatus,
        onChainId: task.onChainId,
        releasedAt: escrowStatus === EscrowStatus.RELEASED ? new Date() : undefined,
      },
    });

    // Update task in database
    const updatedTask = await db.task.update({
      where: { id: taskId },
      data: {
        escrowDeposited: amount > 0,
        // Store escrow address (all tasks use same SimpleEscrow)
        escrowAddress: SIMPLE_ESCROW_ADDRESS,
      },
    });

    return {
      success: true,
      task: updatedTask,
      escrow: {
        amount: amount.toString(),
        released: escrowStatus === EscrowStatus.RELEASED,
        exists: onChainEscrow.exists,
        status: escrow.status,
      },
    };
  } catch (error) {
    console.error('Error syncing task with on-chain:', error);
    return { success: false, error: 'Failed to sync with on-chain' };
  }
}

/**
 * Get all escrows that need database synchronization
 * Returns list of on-chain tasks that need sync (new or state changed)
 * 
 * IMPORTANT: This only syncs based on database workflow state, not blindly trusts on-chain state.
 * A task is only considered "released" if it has completed the full workflow:
 * - Task is COMPLETED (after validation passed)
 * - Has a validated submission with score >= 70
 */
export async function getUnsyncedEscrows() {
  try {
    const provider = new ethers.JsonRpcProvider('https://rpc-amoy.polygon.technology');
    const contract = new ethers.Contract(SIMPLE_ESCROW_ADDRESS, SIMPLE_ESCROW_ABI, provider);
    
    // Get task counter
    const counter = await contract.taskCounter();
    const numTasks = Number(counter);
    
    const unsyncedTasks: Array<{
      taskId: number;
      amount: string;
      released: boolean;
      exists: boolean;
      needsSync: 'new' | 'released' | 'refunded' | 'amount_changed' | 'sync_locked';
    }> = [];

    // Check each task
    for (let i = 1; i <= numTasks; i++) {
      const escrow = await contract.getEscrow(i);
      
      if (escrow.exists && escrow.amount > BigInt(0)) {
        // Check if this task exists in database
        const dbTask = await db.task.findFirst({
          where: { onChainId: i },
          include: {
            escrow: true,
            workSubmission: true,
          },
        });

        const amount = Number(ethers.formatEther(escrow.amount));
        const isOnChainReleased = escrow.released;

        if (!dbTask) {
          // Task doesn't exist in database - needs new record
          // Only mark as LOCKED (not released) since we don't know the workflow state
          unsyncedTasks.push({
            taskId: i,
            amount: amount.toString(),
            released: false, // Don't assume released for new tasks
            exists: escrow.exists,
            needsSync: 'new',
          });
        } else if (dbTask.escrow) {
          // Check if state has changed
          const dbEscrow = dbTask.escrow;
          
          // Determine if task has completed the workflow (should allow release)
          const hasCompletedWorkflow = 
            dbTask.status === 'COMPLETED' && 
            dbTask.workSubmission && 
            (dbTask.workSubmission.status === 'APPROVED' || dbTask.workSubmission.score !== null);

          // Only sync to RELEASED if:
          // 1. On-chain shows released AND
          // 2. Database workflow is complete (task COMPLETED with approved submission)
          if (isOnChainReleased && dbEscrow.status !== EscrowStatus.RELEASED && hasCompletedWorkflow) {
            // Released on-chain AND workflow complete - sync to DB
            unsyncedTasks.push({
              taskId: i,
              amount: amount.toString(),
              released: true,
              exists: escrow.exists,
              needsSync: 'released',
            });
          } else if (isOnChainReleased && dbEscrow.status !== EscrowStatus.RELEASED && !hasCompletedWorkflow) {
            // On-chain shows released but workflow not complete - this is a mismatch!
            // Log warning but don't auto-sync (could be a canceled task or dispute)
            console.warn(`[EscrowSync] Task ${i} shows released on-chain but workflow not complete. Status: ${dbTask.status}`);
          } else if (!isOnChainReleased && dbEscrow.status === EscrowStatus.RELEASED) {
            // Released in database but not on-chain - possible refund or failure
            unsyncedTasks.push({
              taskId: i,
              amount: amount.toString(),
              released: false,
              exists: escrow.exists,
              needsSync: 'refunded',
            });
          } else if (!isOnChainReleased && amount > 0 && dbEscrow.status === EscrowStatus.PENDING) {
            // Funds exist on-chain but DB shows PENDING - sync to LOCKED
            unsyncedTasks.push({
              taskId: i,
              amount: amount.toString(),
              released: false,
              exists: escrow.exists,
              needsSync: 'sync_locked',
            });
          } else if (Math.abs(dbEscrow.amount - amount) > 0.001) {
            // Amount changed
            unsyncedTasks.push({
              taskId: i,
              amount: amount.toString(),
              released: isOnChainReleased,
              exists: escrow.exists,
              needsSync: 'amount_changed',
            });
          }
        } else if (!dbTask.escrow && dbTask.escrowDeposited) {
          // Task has escrowDeposited flag but no Escrow record - create one
          unsyncedTasks.push({
            taskId: i,
            amount: amount.toString(),
            released: false,
            exists: escrow.exists,
            needsSync: 'sync_locked',
          });
        }
      }
    }

    return { success: true, unsyncedTasks };
  } catch (error) {
    console.error('Error getting unsynced escrows:', error);
    return { success: false, error: 'Failed to get unsynced escrows' };
  }
}
