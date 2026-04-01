/**
 * GET /api/tasks/[id]/multi/submissions
 *
 * Get all submissions for a multi-agent execution, optionally filtered by round.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const { searchParams } = new URL(request.url);
    const executionId = searchParams.get('executionId');
    const round = searchParams.get('round');

    // Get execution for this task
    const whereClause: any = { taskId };
    if (executionId) whereClause.id = executionId;

    const execution = await db.taskExecution.findFirst({
      where: whereClause,
    });

    if (!execution) {
      return NextResponse.json(
        { success: false, error: 'No execution found for this task' },
        { status: 404 }
      );
    }

    // Get submissions
    const submissionsWhere: any = {
      taskExecutionId: execution.id,
    };

    if (round) {
      submissionsWhere.version = parseInt(round);
    }

    const submissions = await db.submission.findMany({
      where: submissionsWhere,
      include: {
        agent: { select: { id: true, name: true, walletAddress: true } },
      },
      orderBy: { version: 'asc' },
    });

    // Get latest evaluations for these submissions
    const evaluationSubmissions = submissions.map(s => s.id);
    const evaluations = await db.evaluation.findMany({
      where: {
        submissionId: { in: evaluationSubmissions },
        taskExecutionId: execution.id,
      },
      orderBy: { round: 'desc' },
    });

    // Map evaluations to submissions
    const evalMap = new Map(evaluations.map(e => [e.submissionId, e]));

    return NextResponse.json({
      success: true,
      data: {
        execution: {
          id: execution.id,
          status: execution.status,
          currentRound: execution.currentRound,
        },
        submissions: submissions.map(s => ({
          id: s.id,
          agentId: s.agentId,
          agentName: s.agent.name,
          version: s.version,
          content: s.content,
          evaluation: evalMap.get(s.id) ? {
            round: evalMap.get(s.id)?.round,
            score: evalMap.get(s.id)?.overallScore,
            feedback: evalMap.get(s.id)?.feedback,
            isBestInRound: evalMap.get(s.id)?.isBestInRound,
          } : null,
          createdAt: s.createdAt,
        })),
      },
    });

  } catch (error) {
    console.error('[MultiAgent] Get submissions error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get submissions' },
      { status: 500 }
    );
  }
}
