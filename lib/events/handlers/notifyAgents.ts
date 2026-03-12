/**
 * Notify Agents Handler
 * 
 * Handles TASK_CREATED events to notify matching agents
 */

import { emit, on } from '../eventBus';
import { EVENTS, TaskCreatedEvent, BidSubmittedEvent } from '../events';
import { db } from '@/lib/db';
import { Channel, NotificationStatus, NotificationType } from '@prisma/client';

/**
 * Notify all agents when a task is created
 */
export async function handleTaskCreated(payload: TaskCreatedEvent): Promise<void> {
  console.log(`[NotifyAgents] Handling TASK_CREATED for task ${payload.taskId}`);

  try {
    // Get all active agents
    const agents = await db.agent.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        walletAddress: true,
        capabilities: true,
      },
    });

    console.log(`[NotifyAgents] Notifying ${agents.length} agents`);

    // Create notifications for each agent
    const notificationPromises = agents.map(agent => {
      // Parse capabilities to check if agent can handle this task
      let capabilities: string[] = [];
      try {
        capabilities = JSON.parse(agent.capabilities || '[]');
      } catch {
        capabilities = [];
      }

      // In a real implementation, we'd filter by capabilities
      // For now, notify all active agents
      return db.notification.create({
        data: {
          type: NotificationType.TASK_CREATED,
          recipientId: agent.id,
          channel: Channel.WEBHOOK,
          payload: JSON.stringify({
            taskId: payload.taskId,
            numericId: payload.numericId,
            title: payload.title,
            description: payload.description,
            reward: payload.reward,
            tokenSymbol: payload.tokenSymbol,
            deadline: payload.deadline,
          }),
          status: NotificationStatus.PENDING,
        },
      });
    });

    await Promise.all(notificationPromises);
    console.log(`[NotifyAgents] Created ${notificationPromises.length} notifications`);
  } catch (error) {
    console.error('[NotifyAgents] Error handling TASK_CREATED:', error);
  }
}

/**
 * Notify agent when their bid is accepted
 */
export async function handleBidAccepted(payload: BidSubmittedEvent): Promise<void> {
  // This is handled by the notification service directly
  console.log(`[NotifyAgents] Bid accepted event received`);
}

/**
 * Register all event handlers
 */
export function registerNotifyAgentsHandlers(): void {
  on<TaskCreatedEvent>(EVENTS.TASK_CREATED, handleTaskCreated);
  console.log('[NotifyAgents] Registered handlers');
}
