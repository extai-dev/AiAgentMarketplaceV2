/**
 * Work Service Module
 * 
 * Handles work submission and validation:
 * - submitWork: Agent submits completed work
 * - validateWork: Validator reviews submitted work
 * - storeEvidence: Store evidence files on IPFS
 */

import { db } from '@/lib/db';
import { SubmissionStatus, ValidationStatus } from '@prisma/client';
import { chaosChainService } from '@/lib/chaoschain-service';
import { startValidation, completeTask, failTask } from './task-service';
import { releaseEscrowFunds, refundEscrowFunds } from './escrow-service';
import { notifyWorkSubmitted } from './notification-service';

export interface SubmitWorkParams {
  taskId: string;
  agentId: string;
  resultUri?: string;
  evidenceUri?: string;
  dataHash?: string;
}

export interface ValidateWorkParams {
  workSubmissionId: string;
  validatorAgentId?: string;
  validatorWallet?: string;
  score: number; // 0-100
  comments?: string;
  evidence?: Record<string, any>;
}

/**
 * Submit completed work for a task
 */
export async function submitWork(params: SubmitWorkParams): Promise<{
  success: boolean;
  submission?: any;
  error?: string;
}> {
  try {
    // Verify task exists and is in progress
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.status !== 'IN_PROGRESS') {
      return { success: false, error: `Task is not in progress, current status: ${task.status}` };
    }

    // Verify agent is assigned to this task
    if (task.agentId !== params.agentId) {
      return { success: false, error: 'Agent is not assigned to this task' };
    }

    // Check if submission already exists
    const existing = await db.workSubmission.findUnique({
      where: { taskId: params.taskId },
    });

    if (existing) {
      return { success: false, error: 'Work already submitted for this task' };
    }

    // Submit work to ChaosChain for verification (optional)
    let threadRoot: string | undefined;
    let evidenceRoot: string | undefined;
    
    if (params.dataHash) {
      try {
        // In a real implementation, this would submit to ChaosChain
        // For now, we'll generate placeholder roots
        threadRoot = `thread_${params.dataHash.slice(0, 16)}`;
        evidenceRoot = `evidence_${params.dataHash.slice(0, 16)}`;
      } catch (error) {
        console.error('Error submitting to ChaosChain:', error);
      }
    }

    // Create work submission
    const submission = await db.workSubmission.create({
      data: {
        taskId: params.taskId,
        agentId: params.agentId,
        resultUri: params.resultUri,
        evidenceUri: params.evidenceUri,
        dataHash: params.dataHash,
        threadRoot,
        evidenceRoot,
        status: SubmissionStatus.PENDING,
      },
    });

    // Update task status to SUBMITTED
    await db.task.update({
      where: { id: params.taskId },
      data: { status: 'SUBMITTED' },
    });

    // Notify task creator
    await notifyWorkSubmitted({ taskId: params.taskId });

    return { success: true, submission };
  } catch (error) {
    console.error('Error submitting work:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to submit work' };
  }
}

/**
 * Start validation process
 */
export async function startWorkValidation(taskId: string): Promise<{
  success: boolean;
  submission?: any;
  error?: string;
}> {
  try {
    const submission = await db.workSubmission.findUnique({
      where: { taskId },
    });

    if (!submission) {
      return { success: false, error: 'No work submission found' };
    }

    // Update submission status
    const updatedSubmission = await db.workSubmission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.VALIDATING },
    });

    // Update task status
    await startValidation({ taskId });

    return { success: true, submission: updatedSubmission };
  } catch (error) {
    console.error('Error starting validation:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to start validation' };
  }
}

/**
 * Validate submitted work
 */
export async function validateWork(params: ValidateWorkParams): Promise<{
  success: boolean;
  validation?: any;
  error?: string;
}> {
  try {
    const submission = await db.workSubmission.findUnique({
      where: { id: params.workSubmissionId },
    });

    if (!submission) {
      return { success: false, error: 'Work submission not found' };
    }

    // Create validation record
    const validation = await db.validation.create({
      data: {
        workSubmissionId: params.workSubmissionId,
        validatorAgentId: params.validatorAgentId,
        validatorWallet: params.validatorWallet,
        score: params.score,
        comments: params.comments,
        evidence: params.evidence ? JSON.stringify(params.evidence) : null,
        status: params.score >= 70 ? ValidationStatus.PASSED : ValidationStatus.FAILED,
        completedAt: new Date(),
      },
    });

    // Update submission status
    const submissionStatus = params.score >= 70 ? SubmissionStatus.APPROVED : SubmissionStatus.REJECTED;
    await db.workSubmission.update({
      where: { id: params.workSubmissionId },
      data: {
        status: submissionStatus,
        validatedAt: new Date(),
      },
    });

    // Get task and handle escrow
    const task = await db.task.findUnique({
      where: { id: submission.taskId },
      include: { escrow: true },
    });

    if (task && task.escrow) {
      if (params.score >= 70) {
        // Release escrow to agent
        await releaseEscrowFunds({
          escrowId: task.escrow.id,
        });
      } else {
        // Refund escrow to payer
        await refundEscrowFunds({
          escrowId: task.escrow.id,
          reason: `Validation failed with score ${params.score}`,
        });
      }
    }

    // Update task status
    if (params.score >= 70) {
      await completeTask({
        taskId: submission.taskId,
        resultHash: submission.dataHash,
      });
    } else {
      await failTask({
        taskId: submission.taskId,
        reason: `Validation failed with score ${params.score}`,
      });
    }

    return { success: true, validation };
  } catch (error) {
    console.error('Error validating work:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to validate work' };
  }
}

/**
 * Get work submission by task ID
 */
export async function getWorkSubmissionByTaskId(taskId: string): Promise<{
  success: boolean;
  submission?: any;
  error?: string;
}> {
  try {
    const submission = await db.workSubmission.findUnique({
      where: { taskId },
      include: {
        validation: true,
        agent: {
          select: {
            id: true,
            name: true,
            walletAddress: true,
          },
        },
      },
    });

    if (!submission) {
      return { success: false, error: 'Work submission not found' };
    }

    return { success: true, submission };
  } catch (error) {
    console.error('Error fetching work submission:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch submission' };
  }
}

/**
 * Store evidence (simulated IPFS upload)
 * In production, this would upload to IPFS and return the URI
 */
export async function storeEvidence(params: {
  data: Record<string, any>;
  filename?: string;
}): Promise<{
  success: boolean;
  uri?: string;
  hash?: string;
  error?: string;
}> {
  try {
    // Simulate IPFS upload by creating a data URI
    const jsonString = JSON.stringify(params.data);
    const hash = await calculateHash(jsonString);
    
    // In production, use actual IPFS upload
    // const result = await ipfsClient.add(jsonString);
    // const uri = `ipfs://${result.cid}`;
    
    // For now, return a data URL
    const uri = `data:application/json;base64,${Buffer.from(jsonString).toString('base64')}`;
    
    return { success: true, uri, hash };
  } catch (error) {
    console.error('Error storing evidence:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to store evidence' };
  }
}

/**
 * Calculate SHA256 hash
 */
async function calculateHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Submit work proof to ChaosChain
 * This registers the work on-chain for verifiability
 */
export async function submitWorkProof(params: {
  taskId: string;
  dataHash: string;
  threadRoot?: string;
  evidenceRoot?: string;
}): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // In production, this would call ChaosChain SDK to submit proof
    // For now, simulate with a placeholder
    const txHash = `0x${params.dataHash.slice(0, 64)}`;

    // Update task with result hash
    await db.task.update({
      where: { id: params.taskId },
      data: { resultHash: params.dataHash },
    });

    return { success: true, txHash };
  } catch (error) {
    console.error('Error submitting work proof:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to submit proof' };
  }
}
