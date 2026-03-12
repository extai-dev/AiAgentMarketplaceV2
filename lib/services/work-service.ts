/**
 * Work Service
 * 
 * Handles work submission and validation for tasks.
 */

import { db } from '@/lib/db';
import { TaskStatus, SubmissionStatus } from '@prisma/client';
import { emit } from '@/lib/events/eventBus';
import { EVENTS } from '@/lib/events/events';

export interface SubmitWorkInput {
  taskId: string;
  agentId: string;
  content: string;
  resultUri?: string;
  resultHash?: string;
}

export interface ValidateWorkInput {
  workSubmissionId: string;
  score: number;
  comments?: string;
  evidence?: Record<string, any>;
  validatedBy?: string;
}

/**
 * Submit work for a task
 * 
 * This is called by an agent when they complete a task.
 * The work is then validated by the task creator.
 */
export async function submitWork(input: SubmitWorkInput) {
  const { taskId, agentId, content, resultUri, resultHash } = input;

  // Verify task exists and is in progress
  const task = await db.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    return { success: false, error: 'Task not found' };
  }

  if (task.status !== TaskStatus.IN_PROGRESS) {
    return { success: false, error: 'Task is not in progress' };
  }

  // Verify the agent is assigned to this task
  if (task.agentId !== agentId) {
    return { success: false, error: 'Agent is not assigned to this task' };
  }

  // Check if there's already a submission for this task
  const existingSubmission = await db.workSubmission.findUnique({
    where: { taskId },
  });

  if (existingSubmission) {
    return { success: false, error: 'Work has already been submitted for this task' };
  }

  // Create work submission
  const submission = await db.workSubmission.create({
    data: {
      taskId,
      agentId,
      content,
      resultUri,
      resultHash,
      status: SubmissionStatus.PENDING,
    },
    include: {
      task: true,
      agent: {
        select: {
          id: true,
          name: true,
          walletAddress: true,
        },
      },
    },
  });

  // Update task status to VALIDATING
  await db.task.update({
    where: { id: taskId },
    data: { status: TaskStatus.VALIDATING },
  });

  // Emit task submitted event
  await emit(EVENTS.TASK_SUBMITTED, {
    taskId,
    agentId,
    submissionId: submission.id,
    resultUri,
  });

  return {
    success: true,
    submission,
    message: 'Work submitted successfully',
  };
}

/**
 * Validate submitted work
 * 
 * This is called by the task creator to approve or reject work.
 * A score >= 70 is considered passing.
 */
export async function validateWork(input: ValidateWorkInput) {
  const { workSubmissionId, score, comments, evidence, validatedBy } = input;

  // Verify submission exists
  const submission = await db.workSubmission.findUnique({
    where: { id: workSubmissionId },
    include: {
      task: true,
    },
  });

  if (!submission) {
    return { success: false, error: 'Work submission not found' };
  }

  // Get the resultHash from the input (it's stored in submission.resultHash)
  const submissionResult = await db.workSubmission.findUnique({
    where: { id: workSubmissionId },
    select: { resultHash: true },
  });

  // Can only validate pending or validating submissions
  if (submission.status !== SubmissionStatus.PENDING && 
      submission.status !== SubmissionStatus.VALIDATING) {
    return { success: false, error: 'Submission has already been validated' };
  }

  // Determine if passed
  const passed = score >= 70;

  // Update submission with validation result
  const updatedSubmission = await db.workSubmission.update({
    where: { id: workSubmissionId },
    data: {
      score,
      comments,
      evidence: evidence ? JSON.stringify(evidence) : null,
      validatedBy,
      validatedAt: new Date(),
      status: passed ? SubmissionStatus.APPROVED : SubmissionStatus.REJECTED,
    },
    include: {
      task: true,
      agent: {
        select: {
          id: true,
          name: true,
          walletAddress: true,
        },
      },
    },
  });

  // Update task status based on validation result
  if (passed) {
    await db.task.update({
      where: { id: submission.taskId },
      data: {
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
        resultHash: submissionResult?.resultHash || null,
      },
    });

    // Emit task completed event
    await emit(EVENTS.TASK_COMPLETED, {
      taskId: submission.taskId,
      agentId: submission.agentId,
      resultHash: submissionResult?.resultHash || undefined,
    });
  } else {
    await db.task.update({
      where: { id: submission.taskId },
      data: { status: TaskStatus.IN_PROGRESS },
    });

    // Emit task failed event
    await emit(EVENTS.TASK_FAILED, {
      taskId: submission.taskId,
      reason: comments || 'Work did not meet validation criteria',
    });
  }

  // Emit validation completed event
  await emit(EVENTS.VALIDATION_COMPLETED, {
    taskId: submission.taskId,
    submissionId: workSubmissionId,
    passed,
    score,
    comments,
  });

  return {
    success: true,
    validation: updatedSubmission,
    message: passed ? 'Validation passed' : 'Validation failed',
  };
}

/**
 * Get work submission for a task
 */
export async function getWorkSubmissionByTaskId(taskId: string) {
  const submission = await db.workSubmission.findUnique({
    where: { taskId },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          walletAddress: true,
        },
      },
    },
  });

  return submission;
}

/**
 * Get work submission by ID
 */
export async function getWorkSubmissionById(submissionId: string) {
  const submission = await db.workSubmission.findUnique({
    where: { id: submissionId },
    include: {
      task: {
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              walletAddress: true,
            },
          },
        },
      },
      agent: {
        select: {
          id: true,
          name: true,
          walletAddress: true,
        },
      },
    },
  });

  return submission;
}
