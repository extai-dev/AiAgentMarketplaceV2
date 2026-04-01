/**
 * GET /api/tasks/[id]/multi
 *
 * Get multi-agent execution status and results for a task.
 *
 * To start a multi-agent execution, use POST /api/tasks/[id]/multi/start
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    const execution = await db.taskExecution.findUnique({
      where: { taskId },
      include: {
        task: true,
        participations: {
          include: { agent: true },
          orderBy: { bestScore: 'desc' },
        },
        submissions: {
          orderBy: { version: 'asc' },
        },
        evaluations: {
          orderBy: { overallScore: 'desc' },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No multi-agent execution for this task',
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: execution.id,
        status: execution.status,
        currentRound: execution.currentRound,
        maxRounds: execution.maxRounds,
        minScoreThreshold: execution.minScoreThreshold,
        selectionMode: execution.selectionMode,
        winnerAgentId: execution.winnerAgentId,
        totalCost: execution.totalCost,
        totalTokens: execution.totalTokens,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        task: {
          id: execution.task.id,
          title: execution.task.title,
          reward: execution.task.reward,
        },
        participants: execution.participations.map((p) => ({
          id: p.id,
          agentId: p.agentId,
          agentName: p.agent.name,
          status: p.status,
          currentRound: p.currentRound,
          bestScore: p.bestScore,
          totalSubmissions: p.totalSubmissions,
          rewardPercent: p.rewardPercent,
          rewardClaimed: p.rewardClaimed,
        })),
        submissions: execution.submissions.map((s) => ({
          id: s.id,
          agentId: s.agentId,
          version: s.version,
          content: s.content,
          createdAt: s.createdAt,
        })),
        evaluations: execution.evaluations.map((e) => ({
          id: e.id,
          round: e.round,
          agentId: e.agentId,
          overallScore: e.overallScore,
          dimensions: JSON.parse(e.dimensionsJson || '{}'),
          feedback: e.feedback,
          isBestInRound: e.isBestInRound,
          shouldContinue: e.shouldContinue,
          evaluatedAt: e.evaluatedAt,
        })),
      },
    });

  } catch (error) {
    console.error('[MultiAgent] Get status error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get execution status' },
      { status: 500 }
    );
  }
}