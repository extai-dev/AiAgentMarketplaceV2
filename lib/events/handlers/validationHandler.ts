/**
 * Validation Handler
 * 
 * Handles work submission and validation workflow
 */

import { on } from '../eventBus';
import { EVENTS, TaskSubmittedEvent, TaskCompletedEvent, TaskFailedEvent } from '../events';
import { db } from '@/lib/db';
import { SubmissionStatus, TaskStatus } from '@prisma/client';

/**
 * Handle work submitted - start validation
 */
export async function handleTaskSubmitted(payload: TaskSubmittedEvent): Promise<void> {
  console.log(`[ValidationHandler] Handling task submitted for task ${payload.taskId}`);

  try {
    const task = await db.task.findUnique({
      where: { id: payload.taskId },
      include: {
        workSubmission: true,
      },
    });

    if (!task || !task.workSubmission) {
      console.log(`[ValidationHandler] No work submission found for task ${payload.taskId}`);
      return;
    }

    // Update submission status to VALIDATING
    await db.workSubmission.update({
      where: { id: task.workSubmission.id },
      data: { status: SubmissionStatus.VALIDATING },
    });

    // Update task status to VALIDATING
    await db.task.update({
      where: { id: payload.taskId },
      data: { status: TaskStatus.VALIDATING },
    });

    console.log(`[ValidationHandler] Started validation for task ${payload.taskId}`);
  } catch (error) {
    console.error('[ValidationHandler] Error handling task submitted:', error);
  }
}

/**
 * Handle task completed - update task and submission
 */
export async function handleTaskCompleted(payload: TaskCompletedEvent): Promise<void> {
  console.log(`[ValidationHandler] Handling task completed for task ${payload.taskId}`);

  try {
    const task = await db.task.findUnique({
      where: { id: payload.taskId },
      include: {
        workSubmission: true,
        agent: true,
      },
    });

    if (!task) return;

    // Update task status to COMPLETE
    await db.task.update({
      where: { id: payload.taskId },
      data: {
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
        resultHash: payload.resultHash,
      },
    });

    // Update work submission status
    if (task.workSubmission) {
      await db.workSubmission.update({
        where: { id: task.workSubmission.id },
        data: {
          status: SubmissionStatus.APPROVED,
          validatedAt: new Date(),
        },
      });
    }

    // Update agent stats
    if (task.agent) {
      await db.agent.update({
        where: { id: task.agent.id },
        data: {
          completedTasks: { increment: 1 },
        },
      });
    }

    console.log(`[ValidationHandler] Completed task ${payload.taskId}`);
  } catch (error) {
    console.error('[ValidationHandler] Error handling task completed:', error);
  }
}

/**
 * Handle task failed - update task and submission
 */
export async function handleTaskFailed(payload: TaskFailedEvent): Promise<void> {
  console.log(`[ValidationHandler] Handling task failed for task ${payload.taskId}`);

  try {
    const task = await db.task.findUnique({
      where: { id: payload.taskId },
      include: {
        workSubmission: true,
      },
    });

    if (!task) return;

    // Update task status to FAILED
    await db.task.update({
      where: { id: payload.taskId },
      data: { status: TaskStatus.FAILED },
    });

    // Update work submission status
    if (task.workSubmission) {
      await db.workSubmission.update({
        where: { id: task.workSubmission.id },
        data: {
          status: SubmissionStatus.REJECTED,
          validatedAt: new Date(),
        },
      });
    }

    console.log(`[ValidationHandler] Failed task ${payload.taskId}: ${payload.reason}`);
  } catch (error) {
    console.error('[ValidationHandler] Error handling task failed:', error);
  }
}

/**
 * Register event handlers
 */
export function registerValidationHandlers(): void {
  on<TaskSubmittedEvent>(EVENTS.TASK_SUBMITTED, handleTaskSubmitted);
  on<TaskCompletedEvent>(EVENTS.TASK_COMPLETED, handleTaskCompleted);
  on<TaskFailedEvent>(EVENTS.TASK_FAILED, handleTaskFailed);
  console.log('[ValidationHandler] Registered handlers');
}
