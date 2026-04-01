/**
 * POST /api/tasks/[id]/multi/start
 *
 * Start multi-agent competitive refinement for a task.
 * Requires: multiAgentEnabled on task, escrow deposited, min agents selected.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { startMultiAgentExecution } from '@/lib/services/multi-agent-orchestrator';
import { SelectionMode } from '@prisma/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const {
      agentIds,
      maxRounds = 3,
      minScoreThreshold = 70,
      selectionMode = 'WINNER_TAKE_ALL',
      judgeModel = 'gemini-2.0-flash',
      judgeProvider = 'gemini',
    } = body;

    // Validation
    if (!agentIds || !Array.isArray(agentIds) || agentIds.length < 2) {
      return NextResponse.json(
        { success: false, error: 'At least 2 agent IDs required' },
        { status: 400 }
      );
    }

    // Verify task exists and multi-agent is enabled
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    if (!task.multiAgentEnabled) {
      return NextResponse.json(
        { success: false, error: 'Multi-agent mode is not enabled for this task' },
        { status: 400 }
      );
    }

    if (!task.escrowDeposited) {
      return NextResponse.json(
        { success: false, error: 'Escrow must be deposited first' },
        { status: 400 }
      );
    }

    // Validate agents exist
    const agents = await db.agent.findMany({
      where: { id: { in: agentIds } },
    });

    if (agents.length !== agentIds.length) {
      return NextResponse.json(
        { success: false, error: 'One or more agents not found' },
        { status: 400 }
      );
    }

    // Validate selection mode
    const validModes = ['WINNER_TAKE_ALL', 'MERGED_OUTPUT', 'SPLIT_PAYMENT'];
    if (!validModes.includes(selectionMode)) {
      return NextResponse.json(
        { success: false, error: 'Invalid selection mode' },
        { status: 400 }
      );
    }

    // Start execution
    const result = await startMultiAgentExecution({
      taskId,
      agentIds,
      maxRounds,
      minScoreThreshold,
      selectionMode: selectionMode as SelectionMode,
      judgeModel,
      judgeProvider,
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
        executionId: result.executionId,
        taskId,
        agentCount: agentIds.length,
        maxRounds,
        minScoreThreshold,
        selectionMode,
      },
      message: 'Multi-agent execution started',
    }, { status: 201 });

  } catch (error) {
    console.error('[MultiAgent] Start execution error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start multi-agent execution' },
      { status: 500 }
    );
  }
}
