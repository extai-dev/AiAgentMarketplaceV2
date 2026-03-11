/**
 * Agent Execution API Route
 * 
 * Webhook endpoint for agents to receive task execution requests.
 * This is the primary notification mechanism for agents.
 * 
 * POST /api/agents/execute
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { AgentStatus, TaskStatus } from '@prisma/client';
import { submitWork } from '@/lib/services/work-service';
import { recordAgentActivity } from '@/lib/services/agent-service';

/**
 * POST /api/agents/execute
 * 
 * Execute a task for an agent
 * 
 * Body:
 * {
 *   agentId: string,
 *   taskId: string,
 *   input: Record<string, any>,
 *   deadline: string (ISO date),
 *   apiToken: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, taskId, input, deadline, apiToken } = body;

    // Validate required fields
    if (!agentId || !taskId) {
      return NextResponse.json(
        { success: false, error: 'agentId and taskId are required' },
        { status: 400 }
      );
    }

    // Verify agent exists and is active
    const agent = await db.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    if (agent.status !== AgentStatus.ACTIVE) {
      return NextResponse.json(
        { success: false, error: 'Agent is not active' },
        { status: 400 }
      );
    }

    // Verify API token if provided
    if (apiToken && agent.apiTokenHash) {
      const tokenHash = Buffer.from(apiToken).toString('base64');
      if (tokenHash !== agent.apiTokenHash) {
        return NextResponse.json(
          { success: false, error: 'Invalid API token' },
          { status: 401 }
        );
      }
    }

    // Get task details
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    // Verify agent is assigned to this task
    if (task.agentId !== agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent is not assigned to this task' },
        { status: 403 }
      );
    }

    // Verify task is in correct state
    if (task.status !== TaskStatus.IN_PROGRESS) {
      return NextResponse.json(
        { success: false, error: `Task is not in progress, status: ${task.status}` },
        { status: 400 }
      );
    }

    // Check deadline
    if (deadline && new Date(deadline) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'Deadline has passed' },
        { status: 400 }
      );
    }

    // Return execution payload for the agent to process
    return NextResponse.json({
      success: true,
      data: {
        taskId: task.id,
        numericId: task.numericId,
        title: task.title,
        description: task.description,
        requirements: task.requirements,
        inputSchema: task.inputSchema,
        input: input || {},
        deadline: deadline || task.deadline,
        reward: task.reward,
        tokenSymbol: task.tokenSymbol,
      },
    });
  } catch (error) {
    console.error('Error in agent execute:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agents/execute
 * 
 * Get agent's assigned tasks (fallback polling mechanism)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const status = searchParams.get('status') as TaskStatus || 'ASSIGNED';

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'agentId is required' },
        { status: 400 }
      );
    }

    // Verify agent exists
    const agent = await db.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Get assigned tasks
    const tasks = await db.task.findMany({
      where: {
        agentId,
        status: {
          in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS],
        },
      },
      select: {
        id: true,
        numericId: true,
        title: true,
        description: true,
        reward: true,
        tokenSymbol: true,
        status: true,
        deadline: true,
        startedAt: true,
      },
      orderBy: { startedAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    console.error('Error fetching assigned tasks:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
