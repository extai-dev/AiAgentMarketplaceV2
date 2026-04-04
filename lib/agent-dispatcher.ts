import { db } from '@/lib/db';
import { signPayload, decryptApiToken } from '@/lib/agent-crypto';

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

    let responseData: AgentResponse | Record<string, unknown> = {};
    try {
      responseData = await response.json();
    } catch {
      // Non-JSON body is fine — agent acknowledged with a non-JSON 2xx
    }

    // Agents submit their actual bid decision asynchronously via POST /api/agents/callback.
    // The webhook response only needs to be a 2xx acknowledgement; a { decision } field is
    // optional and only used for logging purposes.
    const agentResponse =
      'decision' in responseData &&
      (responseData.decision === 'bid' || responseData.decision === 'skip')
        ? (responseData as AgentResponse)
        : undefined;

    return {
      agentId: agent.id,
      agentName: agent.name,
      status: 'SUCCESS',
      response: agentResponse,
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
  console.log(`[AgentDispatcher] Starting dispatch for task ${task.id} (${task.numericId}): "${task.title}"`);
  
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
      apiTokenEncrypted: true,
      status: true,
    },
  });

  console.log(`[AgentDispatcher] Found ${agents.length} active agents with execUrl`);
  
  if (agents.length === 0) {
    console.warn(`[AgentDispatcher] No active agents with execUrl found. Task ${task.id} will not be dispatched to any agents.`);
    console.warn(`[AgentDispatcher] Make sure agents are registered with execUrl and status is ACTIVE`);
    return [];
  }

  // Dispatch to all agents in parallel
  const results: DispatchResult[] = [];
  
  const dispatchPromises = agents.map(async (agent) => {
    console.log(`[AgentDispatcher] Dispatching to agent: ${agent.name} (${agent.id}) at ${agent.execUrl}`);
    
    // Decrypt the agent's unique API token for signing
    let apiToken: string;
    try {
      if (agent.apiTokenEncrypted) {
        apiToken = decryptApiToken(agent.apiTokenEncrypted);
        console.log(`[AgentDispatcher] Using agent's unique API token for signing`);
      } else {
        // Fallback for agents created before encryption was added
        const signingKey = process.env.AGENT_TOKEN_ENCRYPTION_KEY;
        if (signingKey) {
          // Try to use legacy approach with env key
          apiToken = signingKey + agent.id; // Use env key + agent ID as fallback
          console.warn(`[AgentDispatcher] Agent ${agent.id} has no encrypted token, using legacy fallback`);
        } else {
          throw new Error('No encrypted token and no fallback key available');
        }
      }
    } catch (err) {
      console.error(`[AgentDispatcher] Failed to decrypt token for agent ${agent.id}:`, err);
      return {
        agentId: agent.id,
        agentName: agent.name,
        status: 'FAILED' as const,
        error: 'Failed to get signing token for agent',
      };
    }
    
    // Create dispatch record
    const dispatch = await db.agentDispatch.create({
      data: {
        agentId: agent.id,
        taskId: task.id,
        status: 'PENDING',
      },
    });
    
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
 * Payload sent to an agent participating in a multi-agent competitive round.
 * Round 1 uses type MULTI_AGENT_ROUND; subsequent rounds use REVISION_REQUESTED.
 */
export interface MultiAgentRoundPayload {
  type: 'MULTI_AGENT_ROUND' | 'REVISION_REQUESTED';
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
  round: number;
  taskExecutionId: string;
  feedback?: string;
  instruction: string;
}

/**
 * Dispatch a multi-agent round notification to an agent.
 * Used for both initial generation (round 1) and revision rounds.
 * Agents must respond with { acknowledged: true } and later submit via /multi/submit.
 */
export async function dispatchMultiAgentRound(
  agent: {
    id: string;
    name: string;
    execUrl: string | null;
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
  executionId: string,
  round: number,
  apiToken: string,
  feedback?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!agent.execUrl) {
    return { success: false, error: 'Agent has no execution URL configured' };
  }

  if (agent.status !== 'ACTIVE') {
    return { success: false, error: `Agent status is ${agent.status}` };
  }

  const type: MultiAgentRoundPayload['type'] = round === 1 ? 'MULTI_AGENT_ROUND' : 'REVISION_REQUESTED';
  const instruction =
    round === 1
      ? `Round ${round}: Submit your initial solution (V1). Use executionId "${executionId}" when calling /api/tasks/${task.id}/multi/submit.`
      : `Round ${round}: Revise your submission based on the feedback provided. Use executionId "${executionId}" when calling /api/tasks/${task.id}/multi/submit.`;

  const payload: MultiAgentRoundPayload = {
    type,
    timestamp: new Date().toISOString(),
    notificationId: `multi-${agent.id}-${executionId}-r${round}-${Date.now()}`,
    agent: { id: agent.id, name: agent.name },
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
    round,
    taskExecutionId: executionId,
    feedback,
    instruction,
  };

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
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    return { success: true };
  } catch (error: any) {
    const isTimeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    return {
      success: false,
      error: isTimeout ? 'Agent did not respond within 30 seconds' : (error.message || 'Unknown error'),
    };
  }
}

/**
 * Payload sent to agent when a client requests a revision
 */
export interface RevisionNotificationPayload {
  type: 'REVISION_REQUESTED';
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
  feedback: string;
  previousSubmissions: Array<{
    version: number;
    content: string;
    feedback: string | null;
  }>;
}

/**
 * Dispatch a REVISION_REQUESTED notification to the task's assigned agent.
 * Called by the review endpoint after a client requests changes on a submission.
 * Errors are logged but do not propagate — callers should treat this as best-effort.
 */
export async function dispatchRevisionRequest(
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
    agentId: string | null;
    creator: { walletAddress: string; name: string | null };
  },
  feedback: string,
  allSubmissions: Array<{ version: number; content: string; feedback: string | null }>
): Promise<void> {
  if (!task.agentId) {
    console.warn('[RevisionDispatch] Task has no assigned agent, skipping dispatch');
    return;
  }

  const agent = await db.agent.findUnique({
    where: { id: task.agentId },
    select: { id: true, name: true, execUrl: true, apiTokenEncrypted: true, status: true },
  });

  if (!agent || !agent.execUrl) {
    console.warn(`[RevisionDispatch] Agent ${task.agentId} has no execUrl, skipping`);
    return;
  }

  // Decrypt agent token for payload signing
  let apiToken: string;
  try {
    if (agent.apiTokenEncrypted) {
      apiToken = decryptApiToken(agent.apiTokenEncrypted);
    } else {
      const fallbackKey = process.env.AGENT_TOKEN_ENCRYPTION_KEY;
      if (!fallbackKey) throw new Error('No encrypted token and no fallback key available');
      apiToken = fallbackKey + agent.id;
      console.warn(`[RevisionDispatch] Agent ${agent.id} has no encrypted token, using legacy fallback`);
    }
  } catch (err) {
    console.error('[RevisionDispatch] Failed to decrypt agent token:', err);
    return;
  }

  const notificationId = `revision-${agent.id}-${task.id}-${Date.now()}`;

  const payload: RevisionNotificationPayload = {
    type: 'REVISION_REQUESTED',
    timestamp: new Date().toISOString(),
    notificationId,
    agent: { id: agent.id, name: agent.name },
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
    feedback,
    previousSubmissions: allSubmissions.map(s => ({
      version: s.version,
      content: s.content,
      feedback: s.feedback,
    })),
  };

  const signature = signPayload(payload, apiToken);

  // Record the dispatch attempt
  const dispatch = await db.agentDispatch.create({
    data: { agentId: agent.id, taskId: task.id, status: 'PENDING' },
  });

  const startTime = Date.now();
  try {
    const response = await fetch(agent.execUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-ID': agent.id,
        'X-Signature': signature,
        'X-Notification-ID': notificationId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    const durationMs = Date.now() - startTime;
    const dispatchStatus = response.ok ? 'SUCCESS' : 'FAILED';

    await db.agentDispatch.update({
      where: { id: dispatch.id },
      data: { status: dispatchStatus, respondedAt: new Date(), durationMs },
    });

    await db.agentLog.create({
      data: {
        agentId: agent.id,
        level: dispatchStatus === 'SUCCESS' ? 'INFO' : 'WARN',
        action: 'REVISION_DISPATCHED',
        taskId: task.id,
        message: `Revision request dispatched: ${dispatchStatus}`,
        metadata: JSON.stringify({ durationMs, feedback: feedback.substring(0, 200) }),
      },
    });

    console.log(`[RevisionDispatch] Dispatch to agent ${agent.id}: ${dispatchStatus} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    const dispatchStatus = isTimeout ? 'TIMEOUT' : 'FAILED';

    await db.agentDispatch.update({
      where: { id: dispatch.id },
      data: { status: dispatchStatus, durationMs, errorMessage: err.message },
    });

    console.error(`[RevisionDispatch] Dispatch error (${dispatchStatus}):`, err.message);
  }
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
        agentId: agentId, // Use the agent's ID for the bid
        amount: response.amount,
        message: response.message || `Automated bid from AI agent: ${agent.name}`,
        status: 'PENDING',
        submittedById: agentId,
      },
      include: {
        agent: {
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

    // ── Auto-accept: immediately accept the bid and assign the task ──────────
    // Only triggers when escrow has already been deposited (escrowDeposited = true).
    // If escrow is not yet deposited, the bid stays PENDING until the user deposits
    // escrow — the deposit endpoint then picks up the pending bid and accepts it.
    // Multi-agent tasks skip this entirely (they use a separate competition flow).
    const taskForAutoAccept = await db.task.findUnique({
      where: { id: taskId },
      select: { multiAgentEnabled: true, escrowDeposited: true },
    });

    if (taskForAutoAccept?.multiAgentEnabled) {
      // Multi-agent task — do not auto-accept bids
      return { success: true, bid };
    }

    if (!taskForAutoAccept?.escrowDeposited) {
      // Escrow not yet deposited — leave bid PENDING; deposit endpoint will accept it
      return { success: true, bid };
    }

    // Accept the bid only if no other bid has already been accepted for this task.
    const alreadyAccepted = await db.bid.findFirst({
      where: { taskId, status: 'ACCEPTED' },
      select: { id: true },
    });

    if (!alreadyAccepted) {
      // Accept this bid and move task to IN_PROGRESS
      await db.$transaction([
        db.bid.update({ where: { id: bid.id }, data: { status: 'ACCEPTED' } }),
        db.task.update({
          where: { id: taskId },
          data: { agentId, status: 'IN_PROGRESS' },
        }),
        db.agent.update({
          where: { id: agentId },
          data: { acceptedBids: { increment: 1 } },
        }),
      ]);

      // Log auto-accept
      await db.agentLog.create({
        data: {
          agentId,
          level: 'INFO',
          action: 'BID_AUTO_ACCEPTED',
          taskId,
          message: `Bid auto-accepted. Task assigned and moved to IN_PROGRESS.`,
        },
      });

      // Notify agent via webhook so it starts executing immediately
      if (agent.execUrl) {
        const task = await db.task.findUnique({
          where: { id: taskId },
          include: { creator: { select: { walletAddress: true, name: true } } },
        });

        if (task) {
          const payload = {
            type: 'BID_ACCEPTED',
            timestamp: new Date().toISOString(),
            notificationId: `auto-accept-${bid.id}-${Date.now()}`,
            agent: { id: agent.id, name: agent.name },
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
              creator: { walletAddress: task.creator.walletAddress, name: task.creator.name },
            },
            bid: { id: bid.id, amount: bid.amount, message: bid.message },
          };

          const signingSecret = agent.apiTokenEncrypted
            ? decryptApiToken(agent.apiTokenEncrypted)
            : agent.apiTokenHash || 'default-signing-key';
          const signature = signPayload(payload, signingSecret);

          fetch(agent.execUrl!, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Agent-ID': agent.id,
              'X-Signature': signature,
              'X-Notification-ID': payload.notificationId,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
          }).catch((err: Error) => {
            // Webhook delivery is best-effort; agent will pick it up via checkForAcceptedBids polling
            console.warn(`[AutoAccept] Webhook delivery failed for agent ${agentId}:`, err.message);
          });
        }
      }
    }
    // ── End auto-accept ───────────────────────────────────────────────────────

    return { success: true, bid };
  } catch (error: any) {
    console.error('Error processing agent response:', error);
    return { success: false, error: error.message || 'Failed to submit bid' };
  }
}
