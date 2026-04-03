import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyAgentToken, extractAgentCredentials } from '@/lib/agent-auth';
import { AgentResponse, processAgentResponse, matchesCriteria, AgentCriteria } from '@/lib/agent-dispatcher';

/**
 * POST /api/agents/callback
 * Handle responses from AI agents
 * 
 * This endpoint is called by AI agents when they:
 * 1. Respond to a task notification with a bid decision
 * 2. Send a heartbeat to indicate they are still active
 * 
 * Headers:
 * - X-Agent-ID: Agent's ID
 * - Authorization: Bearer <api_token> OR X-API-Token: <api_token>
 * - X-Notification-ID: Original notification ID (for bid responses)
 * 
 * Request body for bid response:
 * {
 *   type: 'BID_RESPONSE',
 *   taskId: string,
 *   decision: 'bid' | 'skip',
 *   amount?: number,
 *   message?: string
 * }
 * 
 * Request body for heartbeat:
 * {
 *   type: 'HEARTBEAT',
 *   metrics?: { ... }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    console.log('Agent callback received with headers:', request.headers);
    // Extract and verify agent credentials
    const { agentId, apiToken } = extractAgentCredentials(request);

    if (!agentId || !apiToken) {
      return NextResponse.json(
        { success: false, error: 'Missing agent credentials. Provide X-Agent-ID and Authorization headers.' },
        { status: 401 }
      );
    }

    const authResult = await verifyAgentToken(agentId, apiToken);
    console.log('verifyAgentToken apiToken:', apiToken);
    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { type } = body;

    switch (type) {
      case 'BID_RESPONSE':
        return await handleBidResponse(agentId, body, request);

      case 'HEARTBEAT':
        return await handleHeartbeat(agentId, body);

      // Agent came online — returns missed single-agent tasks AND active multi-agent rounds
      case 'CHECKIN':
        return await handleCheckin(agentId, body);

      // Multi-agent callback types
      case 'MULTI_AGENT_SUBMISSION':
        return await handleMultiAgentSubmission(agentId, body);
      
      case 'MULTI_AGENT_REVISION':
        return await handleMultiAgentRevision(agentId, body);
      
      default:
        return NextResponse.json(
          { success: false, error: `Unknown callback type: ${type}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error processing agent callback:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process callback' },
      { status: 500 }
    );
  }
}

/**
 * Handle bid response from agent
 */
async function handleBidResponse(
  agentId: string,
  body: any,
  request: NextRequest
) {
  const { taskId, decision, amount, message, notificationId } = body;

  // Validate required fields
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: 'taskId is required' },
      { status: 400 }
    );
  }

  if (!decision || !['bid', 'skip'].includes(decision)) {
    return NextResponse.json(
      { success: false, error: 'decision must be "bid" or "skip"' },
      { status: 400 }
    );
  }

  // For bid decision, validate amount
  if (decision === 'bid') {
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid bid amount is required when decision is "bid"' },
        { status: 400 }
      );
    }
  }

  // Verify task exists and is open
  const task = await db.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    return NextResponse.json(
      { success: false, error: 'Task not found' },
      { status: 404 }
    );
  }

  // Multi-agent tasks use pre-selected agents — bidding is not allowed
  if (task.multiAgentEnabled) {
    return NextResponse.json(
      { success: false, error: 'This task uses a multi-agent competition. Bidding is not allowed.' },
      { status: 400 }
    );
  }

  if (task.status !== 'OPEN') {
    // Log that agent tried to bid on non-open task
    await db.agentLog.create({
      data: {
        agentId,
        level: 'WARN',
        action: 'BID_REJECTED',
        taskId,
        message: `Cannot bid: task status is ${task.status}`,
      },
    });

    return NextResponse.json(
      { success: false, error: `Task is not open for bidding (status: ${task.status})` },
      { status: 400 }
    );
  }

  // Check if agent already has a pending bid on this task
  const existingBid = await db.bid.findFirst({
    where: {
      taskId,
      submittedById: agentId,
      status: 'PENDING',
    },
  });

  if (existingBid) {
    return NextResponse.json(
      { success: false, error: 'Agent already has a pending bid on this task' },
      { status: 400 }
    );
  }

  // Handle skip decision
  if (decision === 'skip') {
    await db.agentLog.create({
      data: {
        agentId,
        level: 'INFO',
        action: 'TASK_SKIPPED',
        taskId,
        message: `Agent skipped task: ${body.reason || 'No reason provided'}`,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Task skipped',
    });
  }

  // Process bid response
  const response: AgentResponse = {
    decision: 'bid',
    amount,
    message,
  };

  const result = await processAgentResponse(agentId, taskId, response);

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 400 }
    );
  }

  // Update dispatch record if notification ID was provided
  if (notificationId) {
    await db.agentDispatch.updateMany({
      where: {
        agentId,
        taskId,
      },
      data: {
        responseData: JSON.stringify(response),
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      bidId: result.bid?.id,
      amount,
      status: 'PENDING',
    },
    message: 'Bid submitted successfully',
  });
}

/**
 * Handle heartbeat from agent.
 * Updates lastSeen and returns a pendingTasks count so the agent knows
 * whether to immediately call GET /api/agents/callback to pick up work.
 */
async function handleHeartbeat(agentId: string, body: any) {
  const { metrics, status } = body;

  // Update agent's last seen time and status
  const agent = await db.agent.update({
    where: { id: agentId },
    data: {
      lastSeen: new Date(),
      lastError: null,
      status: status || 'ACTIVE',
    },
    select: { criteria: true },
  });

  // Count OPEN tasks this agent should act on (quick check, no full fetch)
  let pendingTasks = 0;
  try {
    let criteria: AgentCriteria = {};
    try {
      criteria = JSON.parse(agent.criteria || '{}');
    } catch { /* ignore */ }

    // Count open single-agent tasks not yet successfully dispatched to this agent
    const openTasks = await db.task.findMany({
      where: { status: 'OPEN', multiAgentEnabled: false },
      select: {
        id: true,
        reward: true,
        title: true,
        description: true,
        escrowDeposited: true,
        dispatches: { where: { agentId, status: { in: ['SUCCESS', 'SKIPPED'] } }, select: { id: true } },
      },
      take: 100,
    });

    for (const task of openTasks) {
      if (task.dispatches.length > 0) continue; // already handled
      const { matches } = matchesCriteria(
        { reward: task.reward, title: task.title, description: task.description, escrowDeposited: task.escrowDeposited },
        criteria
      );
      if (matches) pendingTasks++;
    }
  } catch (err) {
    console.error('[Heartbeat] Error counting pending tasks:', err);
  }

  // Log heartbeat
  await db.agentLog.create({
    data: {
      agentId,
      level: 'DEBUG',
      action: 'HEARTBEAT',
      message: `Agent heartbeat received. Pending tasks: ${pendingTasks}`,
      metadata: metrics ? JSON.stringify(metrics) : undefined,
    },
  });

  return NextResponse.json({
    success: true,
    message: 'Heartbeat received',
    timestamp: new Date().toISOString(),
    pendingTasks,
  });
}

/**
 * GET /api/agents/callback
 * Pull-based task discovery for agents.
 *
 * Returns all OPEN tasks this agent should act on:
 *   1. Existing PENDING dispatches (not yet processed)
 *   2. Previously FAILED or TIMEOUT dispatches whose task is still OPEN
 *      (agent was offline when the push notification arrived)
 *   3. OPEN tasks matching agent criteria with NO dispatch record at all
 *      (agent registered after the task was created, or was never targeted)
 *
 * For categories 2 and 3, new/reset dispatch records are created so the
 * attempt is tracked and won't re-surface after the agent responds.
 *
 * Headers required:
 *   X-Agent-ID: <agentId>
 *   Authorization: Bearer <apiToken>
 */
export async function GET(request: NextRequest) {
  try {
    const { agentId, apiToken } = extractAgentCredentials(request);

    if (!agentId || !apiToken) {
      return NextResponse.json(
        { success: false, error: 'Missing agent credentials' },
        { status: 401 }
      );
    }

    const authResult = await verifyAgentToken(agentId, apiToken);
    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: 401 }
      );
    }

    // Fetch agent to read criteria
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { id: true, criteria: true, lastSeen: true },
    });

    if (!agent) {
      return NextResponse.json({ success: false, error: 'Agent not found' }, { status: 404 });
    }

    let criteria: AgentCriteria = {};
    try {
      criteria = JSON.parse(agent.criteria || '{}');
    } catch {
      // malformed criteria — treat as no filter
    }

    // Load all OPEN single-agent tasks (exclude multi-agent competitions)
    const openTasks = await db.task.findMany({
      where: { status: 'OPEN', multiAgentEnabled: false },
      include: {
        creator: { select: { walletAddress: true, name: true } },
        dispatches: { where: { agentId } },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    // Determine which tasks this agent should act on
    const tasksToReturn: typeof openTasks = [];

    for (const task of openTasks) {
      const dispatch = task.dispatches[0]; // at most one dispatch per agent per task

      // Skip tasks where agent already successfully responded
      if (dispatch?.status === 'SUCCESS' || dispatch?.status === 'SKIPPED') continue;

      // Check whether the task matches agent criteria
      const { matches } = matchesCriteria(
        { reward: task.reward, title: task.title, description: task.description, escrowDeposited: task.escrowDeposited },
        criteria
      );
      if (!matches) continue;

      tasksToReturn.push(task);

      // Ensure a dispatch record exists and is in PENDING state for tracking
      if (!dispatch) {
        // No prior dispatch — agent missed it entirely; create a fresh record
        await db.agentDispatch.create({
          data: { agentId, taskId: task.id, status: 'PENDING' },
        });
      } else if (dispatch.status === 'FAILED' || dispatch.status === 'TIMEOUT') {
        // Prior attempt failed — mark as PENDING again for this retrieval
        await db.agentDispatch.update({
          where: { id: dispatch.id },
          data: {
            status: 'PENDING',
            retryCount: { increment: 1 },
            errorMessage: null,
          },
        });
      }
      // PENDING dispatch: leave as-is — agent is picking it up now
    }

    // Update agent's last seen
    await db.agent.update({
      where: { id: agentId },
      data: { lastSeen: new Date() },
    });

    console.log(
      `[AgentCallback] GET poll from agent ${agentId}: ${tasksToReturn.length} tasks returned (${openTasks.length} open tasks checked)`
    );

    return NextResponse.json({
      success: true,
      data: tasksToReturn.slice(0, 20).map(task => ({
        notificationId: task.dispatches[0]?.id ?? `${agentId}-${task.id}`,
        taskId: task.id,
        type: 'NEW_TASK',
        task: {
          id: task.id,
          numericId: task.numericId,
          title: task.title,
          description: task.description,
          reward: task.reward,
          tokenSymbol: task.tokenSymbol,
          status: task.status,
          deadline: task.deadline,
          escrowDeposited: task.escrowDeposited,
          multiAgentEnabled: task.multiAgentEnabled,
          creator: task.creator,
        },
      })),
      meta: {
        total: tasksToReturn.length,
        returned: Math.min(tasksToReturn.length, 20),
      },
    });
  } catch (error) {
    console.error('Error fetching pending notifications:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

/**
 * Handle agent check-in (CHECKIN).
 *
 * Called when an agent comes online after being offline.
 * Returns:
 *   - pendingTasks: OPEN single-agent tasks matching criteria that weren't
 *     successfully dispatched (missed webhooks + never dispatched)
 *   - activeRounds: active multi-agent executions where this agent is a
 *     participant still waiting to submit (agent missed the round notification)
 *
 * POST /api/agents/callback
 * { type: 'CHECKIN' }
 */
async function handleCheckin(agentId: string, _body: any) {
  // Mark agent online
  const agent = await db.agent.update({
    where: { id: agentId },
    data: { lastSeen: new Date(), status: 'ACTIVE', lastError: null },
    select: { name: true, criteria: true },
  });

  let criteria: AgentCriteria = {};
  try {
    criteria = JSON.parse(agent.criteria || '{}');
  } catch { /* ignore */ }

  // ── 1. Missed single-agent tasks (exclude multi-agent competitions) ──────
  const openTasks = await db.task.findMany({
    where: { status: 'OPEN', multiAgentEnabled: false },
    include: {
      creator: { select: { walletAddress: true, name: true } },
      dispatches: { where: { agentId } },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  const missedTasks: typeof openTasks = [];
  for (const task of openTasks) {
    const dispatch = task.dispatches[0];
    if (dispatch?.status === 'SUCCESS' || dispatch?.status === 'SKIPPED') continue;

    const { matches } = matchesCriteria(
      { reward: task.reward, title: task.title, description: task.description, escrowDeposited: task.escrowDeposited },
      criteria
    );
    if (!matches) continue;

    missedTasks.push(task);

    // Ensure dispatch record is PENDING
    if (!dispatch) {
      await db.agentDispatch.create({ data: { agentId, taskId: task.id, status: 'PENDING' } });
    } else if (dispatch.status === 'FAILED' || dispatch.status === 'TIMEOUT') {
      await db.agentDispatch.update({
        where: { id: dispatch.id },
        data: { status: 'PENDING', retryCount: { increment: 1 }, errorMessage: null },
      });
    }
  }

  // ── 2. Active multi-agent rounds waiting for this agent's submission ────
  const activeParticipations = await db.agentParticipation.findMany({
    where: {
      agentId,
      status: { in: ['INVITED', 'GENERATING', 'REVISING'] },
      taskExecution: {
        status: { in: ['AGENTS_GENERATING', 'REVISING'] },
      },
    },
    include: {
      taskExecution: {
        include: {
          task: {
            include: { creator: { select: { walletAddress: true, name: true } } },
          },
        },
      },
    },
  });

  const activeRounds = activeParticipations.map(p => ({
    executionId: p.taskExecutionId,
    round: p.currentRound,
    status: p.status,
    taskId: p.taskExecution.taskId,
    task: {
      id: p.taskExecution.task.id,
      numericId: p.taskExecution.task.numericId,
      title: p.taskExecution.task.title,
      description: p.taskExecution.task.description,
      reward: p.taskExecution.task.reward,
      tokenSymbol: p.taskExecution.task.tokenSymbol,
      status: p.taskExecution.task.status,
      deadline: p.taskExecution.task.deadline,
      escrowDeposited: p.taskExecution.task.escrowDeposited,
      creator: p.taskExecution.task.creator,
    },
    instruction:
      p.currentRound === 1
        ? `Round ${p.currentRound}: Submit your initial solution. POST to /api/tasks/${p.taskExecution.taskId}/multi/submit with executionId "${p.taskExecutionId}".`
        : `Round ${p.currentRound}: Submit your revised solution. POST to /api/tasks/${p.taskExecution.taskId}/multi/submit with executionId "${p.taskExecutionId}".`,
  }));

  await db.agentLog.create({
    data: {
      agentId,
      level: 'INFO',
      action: 'CHECKIN',
      message: `Agent checked in. Missed tasks: ${missedTasks.length}, active rounds: ${activeRounds.length}`,
    },
  });

  console.log(
    `[AgentCallback] CHECKIN from agent ${agentId} (${agent.name}): ${missedTasks.length} missed tasks, ${activeRounds.length} active rounds`
  );

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    pendingTasks: missedTasks.slice(0, 20).map(task => ({
      notificationId: task.dispatches[0]?.id ?? `${agentId}-${task.id}`,
      taskId: task.id,
      type: 'NEW_TASK',
      task: {
        id: task.id,
        numericId: task.numericId,
        title: task.title,
        description: task.description,
        reward: task.reward,
        tokenSymbol: task.tokenSymbol,
        status: task.status,
        deadline: task.deadline,
        escrowDeposited: task.escrowDeposited,
        multiAgentEnabled: task.multiAgentEnabled,
        creator: task.creator,
      },
    })),
    activeRounds,
    meta: {
      missedTaskCount: missedTasks.length,
      activeRoundCount: activeRounds.length,
    },
  });
}

/**
 * Handle multi-agent submission from an agent
 */
async function handleMultiAgentSubmission(agentId: string, body: any) {
  const { taskExecutionId, taskId, content, round } = body;

  if (!taskExecutionId || !content) {
    return NextResponse.json(
      { success: false, error: 'taskExecutionId and content are required' },
      { status: 400 }
    );
  }

  // Verify agent is part of this execution
  const participation = await db.agentParticipation.findFirst({
    where: { taskExecutionId, agentId },
  });

  if (!participation) {
    return NextResponse.json(
      { success: false, error: 'Agent is not part of this execution' },
      { status: 403 }
    );
  }

  // Submit via orchestrator
  const { submitMultiAgentSubmission } = await import('@/lib/services/multi-agent-orchestrator');
  const result = await submitMultiAgentSubmission({
    executionId: taskExecutionId,
    agentId,
    content,
  });

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      submissionId: result.submissionId,
      round: participation.currentRound,
    },
    message: 'Multi-agent submission recorded',
  });
}

/**
 * Handle multi-agent revision request response
 */
async function handleMultiAgentRevision(agentId: string, body: any) {
  const { taskExecutionId, taskId, content, feedback, round } = body;

  if (!taskExecutionId || !content) {
    return NextResponse.json(
      { success: false, error: 'taskExecutionId and content are required' },
      { status: 400 }
    );
  }

  // Verify agent is part of this execution
  const participation = await db.agentParticipation.findFirst({
    where: { taskExecutionId, agentId },
  });

  if (!participation) {
    return NextResponse.json(
      { success: false, error: 'Agent is not part of this execution' },
      { status: 403 }
    );
  }

  // Submit revision via orchestrator
  const { submitMultiAgentSubmission } = await import('@/lib/services/multi-agent-orchestrator');
  const result = await submitMultiAgentSubmission({
    executionId: taskExecutionId,
    agentId,
    content,
  });

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      submissionId: result.submissionId,
      round: participation.currentRound,
      feedback: feedback || 'Revision submitted',
    },
    message: 'Revision submitted successfully',
  });
}
