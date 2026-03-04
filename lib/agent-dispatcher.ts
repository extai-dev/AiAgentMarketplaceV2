import { db } from '@/lib/db';
import { signPayload } from '@/lib/agent-crypto';

/**
 * Agent criteria structure
 */
export interface AgentCriteria {
  minReward?: number;
  maxReward?: number;
  keywords?: string[];
  categories?: string[];
  requireEscrow?: boolean;
  excludeKeywords?: string[];
}

/**
 * Task notification payload sent to agents
 */
export interface TaskNotificationPayload {
  type: 'NEW_TASK' | 'TASK_UPDATED' | 'TASK_CANCELLED';
  timestamp: string;
  notificationId: string;
  agent: {
    id: string;
    name: string;
  };
  task: {
    id: string;
    numericId: number;
    title: string;
    description: string;
    reward: number;
    tokenSymbol: string;
    status: string;
    deadline: string | null;
    escrowDeposited: boolean;
    creator: {
      walletAddress: string;
      name: string | null;
    };
  };
}

/**
 * Agent response format
 */
export interface AgentResponse {
  decision: 'bid' | 'skip';
  amount?: number;
  message?: string;
  reason?: string;
}

/**
 * Dispatch result
 */
export interface DispatchResult {
  agentId: string;
  agentName: string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'SKIPPED';
  response?: AgentResponse;
  error?: string;
  durationMs?: number;
}

/**
 * Check if a task matches agent criteria
 */
export function matchesCriteria(
  task: { reward: number; title: string; description: string; escrowDeposited: boolean },
  criteria: AgentCriteria
): { matches: boolean; reason?: string } {
  // Check min reward
  if (criteria.minReward !== undefined && task.reward < criteria.minReward) {
    return { matches: false, reason: `Reward ${task.reward} below minimum ${criteria.minReward}` };
  }

  // Check max reward
  if (criteria.maxReward !== undefined && task.reward > criteria.maxReward) {
    return { matches: false, reason: `Reward ${task.reward} above maximum ${criteria.maxReward}` };
  }

  // Check escrow requirement
  if (criteria.requireEscrow && !task.escrowDeposited) {
    return { matches: false, reason: 'Escrow required but not deposited' };
  }

  // Check keywords (if specified, at least one must match)
  if (criteria.keywords && criteria.keywords.length > 0) {
    const text = `${task.title} ${task.description}`.toLowerCase();
    const hasKeyword = criteria.keywords.some(kw =>
      text.includes(kw.toLowerCase())
    );
    if (!hasKeyword) {
      return { matches: false, reason: 'No matching keywords found' };
    }
  }

  // Check exclude keywords
  if (criteria.excludeKeywords && criteria.excludeKeywords.length > 0) {
    const text = `${task.title} ${task.description}`.toLowerCase();
    const hasExcluded = criteria.excludeKeywords.some(kw =>
      text.includes(kw.toLowerCase())
    );
    if (hasExcluded) {
      return { matches: false, reason: 'Contains excluded keyword' };
    }
  }

  return { matches: true };
}

/**
 * Dispatch task notification to a single agent
 */
export async function dispatchToAgent(
  agent: {
    id: string;
    name: string;
    execUrl: string | null;
    criteria: string;
    apiTokenHash: string | null;
    status: string;
  },
  task: {
    id: string;
    numericId: number;
    title: string;
    description: string;
    reward: number;
    tokenSymbol: string;
    status: string;
    deadline: Date | null;
    escrowDeposited: boolean;
    creator: { walletAddress: string; name: string | null };
  },
  apiToken: string
): Promise<DispatchResult> {
  const startTime = Date.now();

  // Check if agent has exec URL
  if (!agent.execUrl) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      status: 'SKIPPED',
      error: 'Agent has no execution URL configured',
    };
  }

  // Check if agent is active
  if (agent.status !== 'ACTIVE') {
    return {
      agentId: agent.id,
      agentName: agent.name,
      status: 'SKIPPED',
      error: `Agent status is ${agent.status}`,
    };
  }

  // Parse and check criteria
  let criteria: AgentCriteria = {};
  try {
    criteria = JSON.parse(agent.criteria || '{}');
  } catch (e) {
    console.error('Failed to parse agent criteria:', e);
  }

  const matchResult = matchesCriteria(task, criteria);
  if (!matchResult.matches) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      status: 'SKIPPED',
      error: matchResult.reason,
    };
  }

  // Build notification payload
  const payload: TaskNotificationPayload = {
    type: 'NEW_TASK',
    timestamp: new Date().toISOString(),
    notificationId: `${agent.id}-${task.id}-${Date.now()}`,
    agent: {
      id: agent.id,
      name: agent.name,
    },
    task: {
      id: task.id,
      numericId: task.numericId,
      title: task.title,
      description: task.description,
      reward: task.reward,
      tokenSymbol: task.tokenSymbol,
      status: task.status,
      deadline: task.deadline ? task.deadline.toISOString() : null,
      escrowDeposited: task.escrowDeposited,
      creator: task.creator,
    },
  };

  // Generate signature
  const signature = signPayload(payload, apiToken);

  try {
    const response = await fetch(agent.execUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-ID': agent.id,
        'X-Signature': signature,
        'X-Notification-ID': payload.notificationId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        status: 'FAILED',
        error: `HTTP ${response.status}: ${response.statusText}`,
        durationMs,
      };
    }

    const responseData = await response.json();
    
    // Validate response format
    if (responseData.decision !== 'bid' && responseData.decision !== 'skip') {
      return {
        agentId: agent.id,
        agentName: agent.name,
        status: 'FAILED',
        error: 'Invalid response: missing or invalid decision field',
        durationMs,
      };
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      status: 'SUCCESS',
      response: responseData,
      durationMs,
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return {
        agentId: agent.id,
        agentName: agent.name,
        status: 'TIMEOUT',
        error: 'Agent did not respond within 30 seconds',
        durationMs,
      };
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      status: 'FAILED',
      error: error.message || 'Unknown error',
      durationMs,
    };
  }
}

/**
 * Dispatch new task notification to all active agents
 */
export async function dispatchNewTask(task: {
  id: string;
  numericId: number;
  title: string;
  description: string;
  reward: number;
  tokenSymbol: string;
  status: string;
  deadline: Date | null;
  escrowDeposited: boolean;
  creator: { walletAddress: string; name: string | null };
}): Promise<DispatchResult[]> {
  // Get all active agents with execution URLs
  const agents = await db.agent.findMany({
    where: {
      status: 'ACTIVE',
      execUrl: { not: null },
    },
    select: {
      id: true,
      name: true,
      execUrl: true,
      criteria: true,
      apiTokenHash: true,
      status: true,
    },
  });

  if (agents.length === 0) {
    return [];
  }

  // Dispatch to all agents in parallel
  const results: DispatchResult[] = [];
  const dispatchPromises = agents.map(async (agent) => {
    // Create dispatch record
    const dispatch = await db.agentDispatch.create({
      data: {
        agentId: agent.id,
        taskId: task.id,
        status: 'PENDING',
      },
    });

    // We need the actual API token for signing, but we only have the hash
    // For now, we'll use a placeholder - in production, tokens should be stored securely
    // or we use a different signing mechanism
    const apiToken = process.env.AGENT_SIGNING_KEY || 'default-signing-key';
    
    const result = await dispatchToAgent(
      agent,
      task,
      apiToken
    );

    // Update dispatch record
    await db.agentDispatch.update({
      where: { id: dispatch.id },
      data: {
        status: result.status === 'SUCCESS' ? 'SUCCESS' : 
                result.status === 'TIMEOUT' ? 'TIMEOUT' : 
                result.status === 'SKIPPED' ? 'SKIPPED' : 'FAILED',
        responseCode: result.response ? 200 : undefined,
        responseData: result.response ? JSON.stringify(result.response) : undefined,
        respondedAt: new Date(),
        durationMs: result.durationMs,
        errorMessage: result.error,
      },
    });

    // Update agent stats
    await db.agent.update({
      where: { id: agent.id },
      data: {
        totalDispatches: { increment: 1 },
        lastSeen: result.status === 'SUCCESS' ? new Date() : undefined,
        lastError: result.status !== 'SUCCESS' && result.status !== 'SKIPPED' 
          ? result.error 
          : undefined,
      },
    });

    // Log the dispatch
    await db.agentLog.create({
      data: {
        agentId: agent.id,
        level: result.status === 'SUCCESS' ? 'INFO' : 
               result.status === 'SKIPPED' ? 'INFO' : 'WARN',
        action: 'TASK_DISPATCHED',
        taskId: task.id,
        message: `Task ${task.numericId} dispatched: ${result.status}`,
        metadata: JSON.stringify({
          status: result.status,
          error: result.error,
          durationMs: result.durationMs,
          response: result.response,
        }),
      },
    });

    return result;
  });

  const settledResults = await Promise.allSettled(dispatchPromises);
  
  for (const settled of settledResults) {
    if (settled.status === 'fulfilled') {
      results.push(settled.value);
    } else {
      console.error('Dispatch promise rejected:', settled.reason);
    }
  }

  return results;
}

/**
 * Process agent response and submit bid if decision is to bid
 */
export async function processAgentResponse(
  agentId: string,
  taskId: string,
  response: AgentResponse
): Promise<{ success: boolean; bid?: any; error?: string }> {
  if (response.decision !== 'bid') {
    return { success: true }; // Agent chose to skip
  }

  // Validate bid amount
  if (!response.amount || response.amount <= 0) {
    return { success: false, error: 'Invalid bid amount' };
  }

  try {
    // Get agent details
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      include: { owner: true },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // Submit bid through the existing API logic
    const bid = await db.bid.create({
      data: {
        taskId,
        agentId: agent.owner.id, // Use owner's user ID for the bid
        amount: response.amount,
        message: response.message || `Automated bid from AI agent: ${agent.name}`,
        status: 'PENDING',
        submittedById: agentId,
      },
      include: {
        user: {
          select: { id: true, walletAddress: true, name: true },
        },
        submittedBy: {
          select: { id: true, name: true, walletAddress: true },
        },
      },
    });

    // Update agent stats
    await db.agent.update({
      where: { id: agentId },
      data: {
        totalBids: { increment: 1 },
      },
    });

    // Log the bid
    await db.agentLog.create({
      data: {
        agentId,
        level: 'INFO',
        action: 'BID_SUBMITTED',
        taskId,
        message: `Bid submitted: ${response.amount} TT`,
        metadata: JSON.stringify({ amount: response.amount, message: response.message }),
      },
    });

    return { success: true, bid };
  } catch (error: any) {
    console.error('Error processing agent response:', error);
    return { success: false, error: error.message || 'Failed to submit bid' };
  }
}
