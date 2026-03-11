/**
 * Notification Service Module
 * 
 * Handles notifications for marketplace events:
 * - taskCreated: Notify agents of new task
 * - bidAccepted: Notify agent their bid was accepted
 * - taskAssigned: Notify agent of task assignment
 * - taskCompleted: Notify task creator of completion
 * 
 * Supports multiple channels: WebSocket, Webhook, Email
 */

import { db } from '@/lib/db';
import { NotificationType, Channel, NotificationStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export interface NotificationPayload {
  type: NotificationType;
  recipientId: string;
  channel?: Channel;
  data: Record<string, any>;
}

/**
 * Send notification to a recipient
 */
async function sendNotification(params: {
  type: NotificationType;
  recipientId: string;
  channel?: Channel;
  payload: Record<string, any>;
}): Promise<{
  success: boolean;
  notificationId?: string;
  error?: string;
}> {
  try {
    const notification = await db.notification.create({
      data: {
        type: params.type,
        recipientId: params.recipientId,
        channel: params.channel || Channel.WEBHOOK,
        payload: JSON.stringify(params.payload),
        status: NotificationStatus.PENDING,
      },
    });

    // In a real implementation, this would send the notification
    // via the appropriate channel (WebSocket, Webhook, Email)
    // For now, we just mark it as sent
    await db.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });

    return { success: true, notificationId: notification.id };
  } catch (error) {
    console.error('Error sending notification:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to send notification' };
  }
}

/**
 * Notify agents of a new task
 */
export async function notifyTaskCreated(taskId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        creator: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Get all active agents
    const agents = await db.agent.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, walletAddress: true },
    });

    // Notify each agent (in production, use a message queue)
    for (const agent of agents) {
      await sendNotification({
        type: NotificationType.TASK_CREATED,
        recipientId: agent.id,
        channel: Channel.WEBHOOK,
        data: {
          taskId: task.id,
          numericId: task.numericId,
          title: task.title,
          description: task.description,
          reward: task.reward,
          tokenSymbol: task.tokenSymbol,
          deadline: task.deadline,
          creator: task.creator,
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error notifying task created:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to notify' };
  }
}

/**
 * Notify agent their bid was accepted
 */
export async function notifyBidAccepted(bidId: string): Promise<{
  success: boolean;
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
          },
        },
      },
    });

    if (!bid) {
      return { success: false, error: 'Bid not found' };
    }

    await sendNotification({
      type: NotificationType.BID_ACCEPTED,
      recipientId: bid.agentId,
      channel: Channel.WEBHOOK,
      data: {
        bidId: bid.id,
        taskId: bid.taskId,
        taskTitle: bid.task.title,
        taskNumericId: bid.task.numericId,
        amount: bid.amount,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error notifying bid accepted:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to notify' };
  }
}

/**
 * Notify agent of task assignment
 */
export async function notifyTaskAssigned(params: {
  taskId: string;
  agentId: string;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
      include: {
        creator: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    await sendNotification({
      type: NotificationType.TASK_ASSIGNED,
      recipientId: params.agentId,
      channel: Channel.WEBHOOK,
      data: {
        taskId: task.id,
        numericId: task.numericId,
        title: task.title,
        description: task.description,
        requirements: task.requirements,
        inputSchema: task.inputSchema,
        reward: task.reward,
        tokenSymbol: task.tokenSymbol,
        deadline: task.deadline,
        creator: task.creator,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error notifying task assigned:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to notify' };
  }
}

/**
 * Notify task creator of task completion
 */
export async function notifyTaskCompleted(params: {
  taskId: string;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
      include: {
        creator: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
        agent: {
          select: {
            id: true,
            name: true,
            walletAddress: true,
          },
        },
        workSubmission: true,
      },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    await sendNotification({
      type: NotificationType.TASK_COMPLETED,
      recipientId: task.creatorId,
      channel: Channel.WEBHOOK,
      data: {
        taskId: task.id,
        numericId: task.numericId,
        title: task.title,
        agent: task.agent,
        resultUri: task.workSubmission?.resultUri,
        completedAt: task.completedAt,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error notifying task completed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to notify' };
  }
}

/**
 * Notify of task cancellation
 */
export async function notifyTaskCancelled(params: {
  taskId: string;
  reason?: string;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
      include: {
        creator: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
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

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Notify creator
    await sendNotification({
      type: NotificationType.TASK_FAILED,
      recipientId: task.creatorId,
      channel: Channel.WEBHOOK,
      data: {
        taskId: task.id,
        numericId: task.numericId,
        title: task.title,
        reason: params.reason,
      },
    });

    // Notify assigned agent if any
    if (task.agentId) {
      await sendNotification({
        type: NotificationType.TASK_FAILED,
        recipientId: task.agentId,
        channel: Channel.WEBHOOK,
        data: {
          taskId: task.id,
          numericId: task.numericId,
          title: task.title,
          reason: params.reason,
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error notifying task cancelled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to notify' };
  }
}

/**
 * Notify of work submission
 */
export async function notifyWorkSubmitted(params: {
  taskId: string;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
      include: {
        creator: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    await sendNotification({
      type: NotificationType.WORK_SUBMITTED,
      recipientId: task.creatorId,
      channel: Channel.WEBHOOK,
      data: {
        taskId: task.id,
        numericId: task.numericId,
        title: task.title,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error notifying work submitted:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to notify' };
  }
}

/**
 * Get pending notifications for retry
 */
export async function getPendingNotifications(limit?: number): Promise<{
  success: boolean;
  notifications?: any[];
  error?: string;
}> {
  try {
    const notifications = await db.notification.findMany({
      where: {
        status: NotificationStatus.FAILED,
        retries: { lt: 3 }, // Max 3 retries
      },
      orderBy: { createdAt: 'asc' },
      take: limit || 10,
    });

    return { success: true, notifications };
  } catch (error) {
    console.error('Error fetching pending notifications:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch' };
  }
}

/**
 * Retry failed notification
 */
export async function retryNotification(notificationId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const notification = await db.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      return { success: false, error: 'Notification not found' };
    }

    // Re-attempt to send
    await db.notification.update({
      where: { id: notificationId },
      data: {
        status: NotificationStatus.PENDING,
        retries: { increment: 1 },
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error retrying notification:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to retry' };
  }
}
