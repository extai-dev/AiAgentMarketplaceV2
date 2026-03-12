/**
 * Reputation Update Handler
 * 
 * Updates agent reputation after task completion
 */

import { on } from '../eventBus';
import { EVENTS, TaskCompletedEvent, TaskFailedEvent } from '../events';
import { db } from '@/lib/db';

/**
 * Handle task completed - update agent reputation
 */
export async function handleTaskCompletedForReputation(payload: TaskCompletedEvent): Promise<void> {
  console.log(`[ReputationUpdate] Handling task completed for agent ${payload.agentId}`);

  try {
    // Get the agent
    const agent = await db.agent.findUnique({
      where: { id: payload.agentId },
    });

    if (!agent) {
      console.log(`[ReputationUpdate] Agent not found: ${payload.agentId}`);
      return;
    }

    // Calculate new reputation score
    // In a real system, this would factor in feedback scores
    const feedbacks = await db.reputationRecord.findMany({
      where: { agentId: payload.agentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (feedbacks.length > 0) {
      const totalScore = feedbacks.reduce((sum, f) => sum + f.score, 0);
      const averageScore = totalScore / feedbacks.length;

      // Calculate reputation score (0-100)
      const reputationScore = averageScore * 20;

      await db.agent.update({
        where: { id: payload.agentId },
        data: {
          reputationScore: Math.round(reputationScore * 10) / 10,
          averageRating: averageScore,
          completedTasks: { increment: 1 },
          totalTasks: { increment: 1 },
        },
      });
    } else {
      // No feedback yet, just increment task counts
      await db.agent.update({
        where: { id: payload.agentId },
        data: {
          completedTasks: { increment: 1 },
          totalTasks: { increment: 1 },
        },
      });
    }

    console.log(`[ReputationUpdate] Updated reputation for agent ${payload.agentId}`);
  } catch (error) {
    console.error('[ReputationUpdate] Error updating reputation:', error);
  }
}

/**
 * Handle task failed - update agent stats
 */
export async function handleTaskFailedForReputation(payload: TaskFailedEvent): Promise<void> {
  console.log(`[ReputationUpdate] Handling task failed for task ${payload.taskId}`);

  try {
    const task = await db.task.findUnique({
      where: { id: payload.taskId },
      select: { agentId: true },
    });

    if (!task?.agentId) return;

    // Increment total tasks (but not completed)
    await db.agent.update({
      where: { id: task.agentId },
      data: {
        totalTasks: { increment: 1 },
      },
    });

    console.log(`[ReputationUpdate] Updated stats for agent ${task.agentId}`);
  } catch (error) {
    console.error('[ReputationUpdate] Error handling task failed:', error);
  }
}

/**
 * Register event handlers
 */
export function registerReputationHandlers(): void {
  on<TaskCompletedEvent>(EVENTS.TASK_COMPLETED, handleTaskCompletedForReputation);
  on<TaskFailedEvent>(EVENTS.TASK_FAILED, handleTaskFailedForReputation);
  console.log('[ReputationUpdate] Registered handlers');
}
