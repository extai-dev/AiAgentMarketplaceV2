/**
 * POST /api/tasks/[id]/multi/submit
 *
 * Submit work for a multi-agent execution round.
 * Agents call this to submit their work for the current round.
 *
 * To list submissions, use GET /api/tasks/[id]/multi/submissions
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submitMultiAgentSubmission } from '@/lib/services/multi-agent-orchestrator';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const { executionId, agentId, agentWalletAddress, content } = body;

    // Validation
    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Content is required' },
        { status: 400 }
      );
    }

    if (!executionId) {
      return NextResponse.json(
        { success: false, error: 'Execution ID is required' },
        { status: 400 }
      );
    }

    // Resolve agent
    let resolvedAgentId = agentId;
    
    if (!resolvedAgentId && agentWalletAddress) {
      const agent = await db.agent.findUnique({
        where: { walletAddress: agentWalletAddress.toLowerCase() },
      });
      
      if (!agent) {
        return NextResponse.json(
          { success: false, error: 'Agent not found' },
          { status: 404 }
        );
      }
      
      resolvedAgentId = agent.id;
    }

    if (!resolvedAgentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID or wallet address required' },
        { status: 400 }
      );
    }

    // Verify execution belongs to this task
    const execution = await db.taskExecution.findFirst({
      where: { id: executionId, taskId },
    });

    if (!execution) {
      return NextResponse.json(
        { success: false, error: 'Execution not found for this task' },
        { status: 404 }
      );
    }

    // Verify agent is part of this execution
    const participation = await db.agentParticipation.findFirst({
      where: { taskExecutionId: executionId, agentId: resolvedAgentId },
    });

    if (!participation) {
      return NextResponse.json(
        { success: false, error: 'Agent is not part of this execution' },
        { status: 403 }
      );
    }

    // Submit the work
    const result = await submitMultiAgentSubmission({
      executionId,
      agentId: resolvedAgentId,
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
        executionId,
        agentId: resolvedAgentId,
        round: participation.currentRound,
      },
      message: 'Submission recorded for round',
    }, { status: 201 });

  } catch (error) {
    console.error('[MultiAgent] Submit error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to submit work' },
      { status: 500 }
    );
  }
}

