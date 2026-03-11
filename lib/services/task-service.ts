/**
 * Task Service Module
 * 
 * Handles task lifecycle:
 * - createTask: Create a new task
 * - publishTask: Publish task to marketplace (status = OPEN)
 * - listOpenTasks: List available tasks for agents
 * - assignTask: Assign task to winning bid
 * - completeTask: Mark task as complete
 * - cancelTask: Cancel task
 * 
 * Integrates with Task State Machine for deterministic transitions
 */

import { db } from '@/lib/db';
import { TaskStatus } from '@prisma/client';
import { 
  canTransitionTo, 
  validateTransition, 
  TASK_STATE_MACHINE,
  TaskTransition 
} from './task-state-machine';
import { createEscrow, lockEscrowFunds } from './escrow-service';
import { notifyTaskAssigned, notifyTaskCompleted, notifyTaskCancelled } from './notification-service';

export interface CreateTaskParams {
  title: string;
  description: string;
  requirements?: string;
  inputSchema?: string;
  reward: number;
  tokenSymbol?: string;
  tokenAddress?: string;
  creatorId: string;
  creatorWallet: string;
  deadline?: Date;
}

export interface TaskFilters {
  status?: TaskStatus;
  creatorId?: string;
  agentId?: string;
  minReward?: number;
  maxReward?: number;
  capabilities?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Get the next numeric ID for a task
 */
async function getNextNumericId(): Promise<number> {
  const maxTask = await db.task.findFirst({
    orderBy: { numericId: 'desc' },
    select: { numericId: true },
  });
  return (maxTask?.numericId || 0) + 1;
}

/**
 * Create a new task (status = CREATED)
 */
export async function createTask(params: CreateTaskParams): Promise<{
  success: boolean;
  task?: any;
  error?: string;
}> {
  try {
    // Validate required fields
    if (!params.title || !params.description) {
      return { success: false, error: 'Title and description are required' };
    }

    if (typeof params.reward !== 'number' || params.reward <= 0) {
      return { success: false, error: 'Reward must be a positive number' };
    }

    // Verify creator exists
    const creator = await db.user.findUnique({
      where: { id: params.creatorId },
    });

    if (!creator) {
      return { success: false, error: 'Creator not found' };
    }

    const numericId = await getNextNumericId();

    const task = await db.task.create({
      data: {
        numericId,
        title: params.title,
        description: params.description,
        requirements: params.requirements,
        inputSchema: params.inputSchema,
        reward: params.reward,
        tokenSymbol: params.tokenSymbol || 'TT',
        tokenAddress: params.tokenAddress,
        creatorId: params.creatorId,
        deadline: params.deadline,
        status: TaskStatus.CREATED,
      },
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

    return { success: true, task };
  } catch (error) {
    console.error('Error creating task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create task' };
  }
}

/**
 * Publish a task to the marketplace (status = OPEN)
 */
export async function publishTask(params: {
  taskId: string;
}): Promise<{
  success: boolean;
  task?: any;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Validate transition
    const transitionError = validateTransition(task.status, TaskStatus.OPEN);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    const updatedTask = await db.task.update({
      where: { id: params.taskId },
      data: { status: TaskStatus.OPEN },
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

    return { success: true, task: updatedTask };
  } catch (error) {
    console.error('Error publishing task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to publish task' };
  }
}

/**
 * List open tasks with filtering
 */
export async function listOpenTasks(params?: TaskFilters): Promise<{
  success: boolean;
  tasks?: any[];
  total?: number;
  error?: string;
}> {
  try {
    const where: any = {};

    // Status filter
    if (params?.status) {
      where.status = params.status;
    } else {
      // Default to open tasks
      where.status = { in: [TaskStatus.OPEN, TaskStatus.BIDDING] };
    }

    // Creator filter
    if (params?.creatorId) {
      where.creatorId = params.creatorId;
    }

    // Agent filter
    if (params?.agentId) {
      where.agentId = params.agentId;
    }

    // Reward range filter
    if (params?.minReward !== undefined || params?.maxReward !== undefined) {
      where.reward = {};
      if (params.minReward !== undefined) {
        where.reward.gte = params.minReward;
      }
      if (params.maxReward !== undefined) {
        where.reward.lte = params.maxReward;
      }
    }

    const tasks = await db.task.findMany({
      where,
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
        _count: {
          select: {
            bids: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: params?.limit || 20,
      skip: params?.offset || 0,
    });

    const total = await db.task.count({ where });

    return { success: true, tasks, total };
  } catch (error) {
    console.error('Error listing tasks:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list tasks' };
  }
}

/**
 * Get task by ID
 */
export async function getTaskById(taskId: string): Promise<{
  success: boolean;
  task?: any;
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
        agent: {
          select: {
            id: true,
            name: true,
            walletAddress: true,
          },
        },
        bids: {
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
        },
        escrow: true,
        workSubmission: true,
      },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    return { success: true, task };
  } catch (error) {
    console.error('Error fetching task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch task' };
  }
}

/**
 * Assign task to an agent (from accepted bid)
 */
export async function assignTask(params: {
  taskId: string;
  agentId: string;
  agentWallet: string;
  escrowAmount?: number;
  escrowToken?: string;
}): Promise<{
  success: boolean;
  task?: any;
  escrow?: any;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Validate transition to ASSIGNED
    const transitionError = validateTransition(task.status, TaskStatus.ASSIGNED);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    // Update task status
    const updatedTask = await db.task.update({
      where: { id: params.taskId },
      data: {
        agentId: params.agentId,
        status: TaskStatus.ASSIGNED,
        startedAt: new Date(),
      },
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

    // Create escrow if amount provided
    let escrow = null;
    if (params.escrowAmount && params.escrowAmount > 0) {
      const escrowResult = await createEscrow({
        taskId: params.taskId,
        payer: task.creatorId,
        agentWallet: params.agentWallet,
        amount: params.escrowAmount,
        token: params.escrowToken || 'USDC',
      });

      if (escrowResult.success && escrowResult.escrow) {
        escrow = escrowResult.escrow;
      }
    }

    // Send notification
    await notifyTaskAssigned({
      taskId: params.taskId,
      agentId: params.agentId,
    });

    return { success: true, task: updatedTask, escrow };
  } catch (error) {
    console.error('Error assigning task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to assign task' };
  }
}

/**
 * Start task execution (status = IN_PROGRESS)
 */
export async function startTaskExecution(params: {
  taskId: string;
}): Promise<{
  success: boolean;
  task?: any;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Validate transition to IN_PROGRESS
    const transitionError = validateTransition(task.status, TaskStatus.IN_PROGRESS);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    const updatedTask = await db.task.update({
      where: { id: params.taskId },
      data: { status: TaskStatus.IN_PROGRESS },
    });

    return { success: true, task: updatedTask };
  } catch (error) {
    console.error('Error starting task execution:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to start task execution' };
  }
}

/**
 * Mark task as submitted (status = SUBMITTED)
 */
export async function submitTask(params: {
  taskId: string;
}): Promise<{
  success: boolean;
  task?: any;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Validate transition to SUBMITTED
    const transitionError = validateTransition(task.status, TaskStatus.SUBMITTED);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    const updatedTask = await db.task.update({
      where: { id: params.taskId },
      data: { status: TaskStatus.SUBMITTED },
    });

    return { success: true, task: updatedTask };
  } catch (error) {
    console.error('Error submitting task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to submit task' };
  }
}

/**
 * Mark task as validating (status = VALIDATING)
 */
export async function startValidation(params: {
  taskId: string;
}): Promise<{
  success: boolean;
  task?: any;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Validate transition to VALIDATING
    const transitionError = validateTransition(task.status, TaskStatus.VALIDATING);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    const updatedTask = await db.task.update({
      where: { id: params.taskId },
      data: { status: TaskStatus.VALIDATING },
    });

    return { success: true, task: updatedTask };
  } catch (error) {
    console.error('Error starting validation:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to start validation' };
  }
}

/**
 * Complete task (status = COMPLETE)
 */
export async function completeTask(params: {
  taskId: string;
  resultHash?: string;
}): Promise<{
  success: boolean;
  task?: any;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Validate transition to COMPLETE
    const transitionError = validateTransition(task.status, TaskStatus.COMPLETE);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    const updatedTask = await db.task.update({
      where: { id: params.taskId },
      data: {
        status: TaskStatus.COMPLETE,
        completedAt: new Date(),
        resultHash: params.resultHash,
      },
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

    // Send notification
    await notifyTaskCompleted({
      taskId: params.taskId,
    });

    return { success: true, task: updatedTask };
  } catch (error) {
    console.error('Error completing task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to complete task' };
  }
}

/**
 * Fail task (status = FAILED)
 */
export async function failTask(params: {
  taskId: string;
  reason?: string;
}): Promise<{
  success: boolean;
  task?: any;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Validate transition to FAILED
    const transitionError = validateTransition(task.status, TaskStatus.FAILED);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    const updatedTask = await db.task.update({
      where: { id: params.taskId },
      data: {
        status: TaskStatus.FAILED,
        completedAt: new Date(),
      },
    });

    // Send notification
    await notifyTaskCancelled({
      taskId: params.taskId,
      reason: params.reason || 'Task failed',
    });

    return { success: true, task: updatedTask };
  } catch (error) {
    console.error('Error failing task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fail task' };
  }
}

/**
 * Cancel task (status = CANCELLED)
 */
export async function cancelTask(params: {
  taskId: string;
  reason?: string;
}): Promise<{
  success: boolean;
  task?: any;
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: params.taskId },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Validate transition to CANCELLED
    const transitionError = validateTransition(task.status, TaskStatus.CANCELLED);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    const updatedTask = await db.task.update({
      where: { id: params.taskId },
      data: {
        status: TaskStatus.CANCELLED,
        completedAt: new Date(),
      },
    });

    // Send notification
    await notifyTaskCancelled({
      taskId: params.taskId,
      reason: params.reason || 'Task cancelled',
    });

    return { success: true, task: updatedTask };
  } catch (error) {
    console.error('Error cancelling task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to cancel task' };
  }
}

/**
 * Get available transitions for a task
 */
export async function getTaskTransitions(taskId: string): Promise<{
  success: boolean;
  currentStatus?: TaskStatus;
  availableTransitions?: TaskStatus[];
  error?: string;
}> {
  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { status: true },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    const availableTransitions = TASK_STATE_MACHINE[task.status] || [];

    return {
      success: true,
      currentStatus: task.status,
      availableTransitions,
    };
  } catch (error) {
    console.error('Error getting task transitions:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get transitions' };
  }
}
