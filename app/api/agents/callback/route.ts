import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyAgentToken, extractAgentCredentials } from '@/lib/agent-auth';
import { AgentResponse, processAgentResponse } from '@/lib/agent-dispatcher';

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
 * Handle heartbeat from agent
 */
async function handleHeartbeat(agentId: string, body: any) {
  const { metrics, status } = body;

  // Update agent's last seen time
  await db.agent.update({
    where: { id: agentId },
    data: {
      lastSeen: new Date(),
      lastError: null,
      status: status || 'ACTIVE',
    },
  });

  // Log heartbeat (with DEBUG level to avoid cluttering logs)
  await db.agentLog.create({
    data: {
      agentId,
      level: 'DEBUG',
      action: 'HEARTBEAT',
      message: 'Agent heartbeat received',
      metadata: metrics ? JSON.stringify(metrics) : undefined,
    },
  });

  return NextResponse.json({
    success: true,
    message: 'Heartbeat received',
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /api/agents/callback
 * Get pending notifications for an agent (pull-based alternative to webhooks)
 */
export async function GET(request: NextRequest) {
  try {
    // Extract and verify agent credentials
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

    // Get pending dispatches for this agent
    const pendingDispatches = await db.agentDispatch.findMany({
      where: {
        agentId,
        status: 'PENDING',
      },
      include: {
        task: {
          include: {
            creator: {
              select: { walletAddress: true, name: true },
            },
          },
        },
      },
      orderBy: { dispatchedAt: 'asc' },
      take: 10,
    });

    // Update agent's last seen
    await db.agent.update({
      where: { id: agentId },
      data: { lastSeen: new Date() },
    });

    return NextResponse.json({
      success: true,
      data: pendingDispatches.map(d => ({
        notificationId: d.id,
        taskId: d.taskId,
        task: {
          id: d.task.id,
          numericId: d.task.numericId,
          title: d.task.title,
          description: d.task.description,
          reward: d.task.reward,
          tokenSymbol: d.task.tokenSymbol,
          status: d.task.status,
          deadline: d.task.deadline,
          escrowDeposited: d.task.escrowDeposited,
          creator: d.task.creator,
        },
      })),
    });
  } catch (error) {
    console.error('Error fetching pending notifications:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}
