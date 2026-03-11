/**
 * Agent Worker Template
 * 
 * An autonomous agent worker that:
 * 1. Polls for available tasks matching capabilities
 * 2. Evaluates tasks and submits bids
 * 3. Executes assigned tasks
 * 4. Submits results
 * 
 * This is a template that agents can extend for their specific capabilities.
 * 
 * Usage:
 * - Configure with agent ID and API token
 * - Extend the executeTask() method for custom logic
 * - Run as a long-running process
 */

import { createAgent, listAgents, getAgentById, updateAgentStatus, recordAgentActivity } from './agent-service';
import { listOpenTasks, getTaskById, startTaskExecution, submitTask } from './task-service';
import { submitBid, evaluateBids } from './bid-service';
import { submitWork } from './work-service';
import { AgentStatus } from '@prisma/client';

export interface AgentWorkerConfig {
  agentId: string;
  apiToken: string;
  capabilities: string[];
  minReward?: number;
  maxReward?: number;
  autoBid: boolean;
  maxConcurrentTasks: number;
  pollIntervalMs: number;
}

export interface TaskExecutionContext {
  taskId: string;
  input: Record<string, any>;
  deadline: Date;
}

export interface TaskExecutionResult {
  success: boolean;
  result?: any;
  evidence?: Record<string, any>;
  error?: string;
}

/**
 * Base Agent Worker Class
 * Extend this to implement custom agent behavior
 */
export class AgentWorker {
  protected config: AgentWorkerConfig;
  protected isRunning: boolean = false;
  protected currentTasks: Set<string> = new Set();

  constructor(config: AgentWorkerConfig) {
    this.config = config;
  }

  /**
   * Start the agent worker
   */
  async start(): Promise<void> {
    console.log(`[AgentWorker] Starting agent ${this.config.agentId}`);
    
    // Verify agent exists
    const agentResult = await getAgentById(this.config.agentId);
    if (!agentResult.success || !agentResult.agent) {
      throw new Error(`Agent ${this.config.agentId} not found`);
    }

    // Update status to active
    await updateAgentStatus({
      agentId: this.config.agentId,
      status: AgentStatus.ACTIVE,
    });

    this.isRunning = true;
    this.runLoop();
  }

  /**
   * Stop the agent worker
   */
  async stop(): Promise<void> {
    console.log(`[AgentWorker] Stopping agent ${this.config.agentId}`);
    this.isRunning = false;
    
    await updateAgentStatus({
      agentId: this.config.agentId,
      status: AgentStatus.PAUSED,
    });
  }

  /**
   * Main worker loop
   */
  protected async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Check concurrent task limit
        if (this.currentTasks.size < this.config.maxConcurrentTasks) {
          // Poll for available tasks
          await this.pollForTasks();
          
          // Check assigned tasks
          await this.checkAssignedTasks();
        } else {
          console.log(`[AgentWorker] At max concurrent tasks (${this.currentTasks.size}), waiting...`);
        }

        // Wait before next iteration
        await this.sleep(this.config.pollIntervalMs);
      } catch (error) {
        console.error('[AgentWorker] Error in main loop:', error);
        await updateAgentStatus({
          agentId: this.config.agentId,
          status: AgentStatus.ERROR,
          lastError: error instanceof Error ? error.message : 'Unknown error',
        });
        
        // Wait before retry
        await this.sleep(this.config.pollIntervalMs * 2);
      }
    }
  }

  /**
   * Poll for available tasks and submit bids
   */
  protected async pollForTasks(): Promise<void> {
    // Get open tasks
    const tasksResult = await listOpenTasks({
      status: 'OPEN',
      minReward: this.config.minReward,
      maxReward: this.config.maxReward,
    });

    if (!tasksResult.success || !tasksResult.tasks) {
      return;
    }

    // Filter by capabilities and evaluate each task
    for (const task of tasksResult.tasks) {
      if (!this.canHandleTask(task)) {
        continue;
      }

      // Evaluate task
      const evaluation = await this.evaluateTask(task);
      if (!evaluation.shouldBid) {
        continue;
      }

      // Submit bid
      if (this.config.autoBid) {
        await this.submitBidForTask(task, evaluation.bidAmount);
      }
    }
  }

  /**
   * Check for assigned tasks and execute them
   */
  protected async checkAssignedTasks(): Promise<void> {
    // Get tasks where this agent is assigned
    const tasksResult = await listOpenTasks({
      status: 'ASSIGNED',
      agentId: this.config.agentId,
    });

    if (!tasksResult.success || !tasksResult.tasks) {
      return;
    }

    for (const task of tasksResult.tasks) {
      if (this.currentTasks.has(task.id)) {
        continue; // Already processing
      }

      // Start task execution
      await this.executeTaskWrapper(task);
    }
  }

  /**
   * Execute a task (wrapper with error handling)
   */
  protected async executeTaskWrapper(task: any): Promise<void> {
    this.currentTasks.add(task.id);
    
    try {
      // Start task execution (update status to IN_PROGRESS)
      await startTaskExecution({ taskId: task.id });

      // Record activity
      await recordAgentActivity({
        agentId: this.config.agentId,
        activityType: 'dispatch',
      });

      // Get task details
      const taskDetails = await getTaskById(task.id);
      if (!taskDetails.success || !taskDetails.task) {
        throw new Error('Failed to get task details');
      }

      // Execute the task (override this method)
      const result = await this.executeTask({
        taskId: task.id,
        input: this.parseTaskInput(taskDetails.task),
        deadline: task.deadline ? new Date(task.deadline) : new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      // Submit work
      if (result.success) {
        await submitWork({
          taskId: task.id,
          agentId: this.config.agentId,
          resultUri: result.result?.uri,
          evidenceUri: result.evidence?.uri,
          dataHash: result.result?.hash,
        });

        await recordAgentActivity({
          agentId: this.config.agentId,
          activityType: 'task_completed',
        });
      } else {
        await recordAgentActivity({
          agentId: this.config.agentId,
          activityType: 'task_failed',
        });
      }
    } catch (error) {
      console.error(`[AgentWorker] Error executing task ${task.id}:`, error);
      
      await recordAgentActivity({
        agentId: this.config.agentId,
        activityType: 'task_failed',
      });

      await updateAgentStatus({
        agentId: this.config.agentId,
        status: AgentStatus.ERROR,
        lastError: error instanceof Error ? error.message : 'Task execution failed',
      });
    } finally {
      this.currentTasks.delete(task.id);
    }
  }

  /**
   * Evaluate if the agent can handle a task
   */
  protected canHandleTask(task: any): boolean {
    // Check if task requirements match agent capabilities
    // This is a simple implementation - override for custom logic
    const taskCapabilities = task.capabilities || [];
    
    return this.config.capabilities.some(cap => 
      taskCapabilities.includes(cap) || 
      task.title.toLowerCase().includes(cap.toLowerCase()) ||
      task.description.toLowerCase().includes(cap.toLowerCase())
    );
  }

  /**
   * Evaluate whether to bid on a task
   */
  protected async evaluateTask(task: any): Promise<{
    shouldBid: boolean;
    bidAmount: number;
    confidence: number;
    reason?: string;
  }> {
    // Default evaluation logic
    // Override this method for custom evaluation
    
    const minPrice = task.reward * 0.7; // Bid at least 70% of reward
    const maxPrice = task.reward * 0.95; // Bid at most 95% of reward
    
    // Calculate bid amount based on various factors
    const baseBid = task.reward * 0.85; // Start at 85%
    
    return {
      shouldBid: true,
      bidAmount: Math.round(baseBid * 100) / 100,
      confidence: 0.8,
      reason: 'Task matches capabilities',
    };
  }

  /**
   * Submit a bid for a task
   */
  protected async submitBidForTask(task: any, amount: number): Promise<boolean> {
    try {
      const result = await submitBid({
        taskId: task.id,
        agentId: this.config.agentId,
        agentWallet: '', // Would be fetched from agent record
        amount,
        message: `I can complete this task using my ${this.config.capabilities.join(', ')} capabilities.`,
      });

      if (result.success) {
        await recordAgentActivity({
          agentId: this.config.agentId,
          activityType: 'bid',
        });
        console.log(`[AgentWorker] Submitted bid for task ${task.numericId}: ${amount} ${task.tokenSymbol}`);
        return true;
      }

      console.log(`[AgentWorker] Failed to bid on task ${task.numericId}: ${result.error}`);
      return false;
    } catch (error) {
      console.error(`[AgentWorker] Error submitting bid:`, error);
      return false;
    }
  }

  /**
   * Parse task input from task data
   */
  protected parseTaskInput(task: any): Record<string, any> {
    try {
      if (task.inputSchema) {
        return JSON.parse(task.inputSchema);
      }
    } catch (error) {
      console.error('[AgentWorker] Error parsing task input:', error);
    }
    
    return {
      description: task.description,
      requirements: task.requirements,
    };
  }

  /**
   * Execute the task - override this method in subclasses
   * 
   * This is the main method to implement custom agent behavior.
   * It should process the task input and return the result.
   */
  protected async executeTask(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    // Default implementation - just echo back the input
    // Override this with actual agent logic
    return {
      success: true,
      result: {
        message: 'Task processed',
        input: context.input,
      },
    };
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Example: Create and start a custom agent worker
 * 
 * ```typescript
 * class CustomAgentWorker extends AgentWorker {
 *   protected async executeTask(context: TaskExecutionContext): Promise<TaskExecutionResult> {
 *     // Custom logic here
 *     const result = await myAIProcess(context.input);
 *     return { success: true, result };
 *   }
 * }
 * 
 * const worker = new CustomAgentWorker({
 *   agentId: 'agent_xxx',
 *   apiToken: 'token_xxx',
 *   capabilities: ['text_generation', 'analysis'],
 *   autoBid: true,
 *   maxConcurrentTasks: 3,
 *   pollIntervalMs: 30000,
 * });
 * 
 * worker.start();
 * ```
 */

export default AgentWorker;
