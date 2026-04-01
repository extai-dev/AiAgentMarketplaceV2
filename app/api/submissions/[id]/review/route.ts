/**
 * POST /api/submissions/[id]/review
 *
 * Client reviews a submission and either approves it or requests a revision.
 *
 * Body:
 * - action: "approve" | "revise"
 * - feedback: string (required when action is "revise")
 *
 * Approve flow:
 *   submission.status → APPROVED
 *   task.status       → COMPLETED  + completedAt
 *   escrow            → released (best-effort)
 *
 * Revise flow:
 *   submission.status → REVISION_REQUESTED  + feedback stored
 *   task.status       → IN_PROGRESS
 *   agent             → notified via REVISION_REQUESTED webhook (best-effort)
 *
 * If the task is already at MAX_REVISIONS when a revision is requested:
 *   task.status → FAILED
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { TaskStatus } from '@prisma/client';
import { getEscrowByTaskId, releaseEscrowFunds, splitEscrowFunds } from '@/lib/services/escrow-service';
import { dispatchRevisionRequest } from '@/lib/agent-dispatcher';

const MAX_REVISIONS = 5;
const AGENT_SPLIT_PERCENT = 80;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: submissionId } = await params;
    const body = await request.json();
    const { action, feedback } = body;

    // Validate action
    if (!action || !['approve', 'revise'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'action must be "approve" or "revise"' },
        { status: 400 }
      );
    }

    if (action === 'revise' && !feedback?.trim()) {
      return NextResponse.json(
        { success: false, error: 'feedback is required when requesting a revision' },
        { status: 400 }
      );
    }

    // Load submission with full task + agent context
    const submission = await db.submission.findUnique({
      where: { id: submissionId },
      include: {
        task: {
          include: {
            agent: true,
            creator: true,
          },
        },
        agent: true,
      },
    });

    if (!submission) {
      return NextResponse.json(
        { success: false, error: 'Submission not found' },
        { status: 404 }
      );
    }

    // Only SUBMITTED submissions can be reviewed
    if (submission.status !== 'SUBMITTED') {
      return NextResponse.json(
        {
          success: false,
          error: `Submission is already in status: ${submission.status}`,
        },
        { status: 400 }
      );
    }

    // ── APPROVE ──────────────────────────────────────────────────────────────
    if (action === 'approve') {
      await db.$transaction([
        db.submission.update({
          where: { id: submissionId },
          data: { status: 'APPROVED' },
        }),
        db.task.update({
          where: { id: submission.taskId },
          data: { status: TaskStatus.COMPLETED, completedAt: new Date() },
        }),
      ]);

      // Release escrow — best-effort, never fail the request
      try {
        const escrowResult = await getEscrowByTaskId(submission.taskId);
        if (
          escrowResult.success &&
          escrowResult.escrow &&
          !escrowResult.escrow.released
        ) {
          await releaseEscrowFunds({ escrowId: escrowResult.escrow.id });
          console.log(`[Review] Escrow released for task ${submission.taskId}`);
        }
      } catch (escrowErr) {
        console.error('[Review] Escrow release failed (non-fatal):', escrowErr);
      }

      return NextResponse.json({
        success: true,
        data: {
          submissionId,
          action: 'approved',
          taskStatus: TaskStatus.COMPLETED,
        },
        message: 'Submission approved and task completed',
      });
    }

    // ── REVISE ────────────────────────────────────────────────────────────────
    const revisionCount = await db.submission.count({
      where: { taskId: submission.taskId },
    });

    if (revisionCount >= MAX_REVISIONS) {
      // Revision cap hit — mark task as FAILED and auto-split escrow
      await db.$transaction([
        db.submission.update({
          where: { id: submissionId },
          data: { status: 'REVISION_REQUESTED', feedback },
        }),
        db.task.update({
          where: { id: submission.taskId },
          data: { status: TaskStatus.FAILED },
        }),
      ]);

      // Auto-split escrow: agent gets AGENT_SPLIT_PERCENT%, creator gets the rest
      let splitResult: { agentAmount?: number; creatorRefundAmount?: number } = {};
      try {
        const sr = await splitEscrowFunds({
          taskId: submission.taskId,
          agentPercent: AGENT_SPLIT_PERCENT,
          reason: `Max revisions (${MAX_REVISIONS}) reached`,
        });
        if (sr.success) {
          splitResult = sr;
          await db.agentLog.create({
            data: {
              agentId: submission.agentId,
              level: 'INFO',
              action: 'ESCROW_SPLIT',
              taskId: submission.taskId,
              message: `Escrow split on max revisions: agent ${sr.agentAmount} TT (${AGENT_SPLIT_PERCENT}%), creator refund ${sr.creatorRefundAmount} TT (${100 - AGENT_SPLIT_PERCENT}%)`,
              metadata: JSON.stringify({ agentPercent: AGENT_SPLIT_PERCENT, agentAmount: sr.agentAmount, creatorRefundAmount: sr.creatorRefundAmount }),
            },
          });
        }
      } catch (splitErr) {
        console.error('[Review] Escrow split failed (non-fatal):', splitErr);
      }

      return NextResponse.json(
        {
          success: false,
          error: `Maximum revisions (${MAX_REVISIONS}) reached. Task failed. Escrow split: agent receives ${AGENT_SPLIT_PERCENT}%, creator refunded ${100 - AGENT_SPLIT_PERCENT}%.`,
          data: {
            taskStatus: TaskStatus.FAILED,
            agentAmount: splitResult.agentAmount,
            creatorRefundAmount: splitResult.creatorRefundAmount,
          },
        },
        { status: 422 }
      );
    }

    // Mark submission and reset task to IN_PROGRESS atomically
    await db.$transaction([
      db.submission.update({
        where: { id: submissionId },
        data: { status: 'REVISION_REQUESTED', feedback },
      }),
      db.task.update({
        where: { id: submission.taskId },
        data: { status: TaskStatus.IN_PROGRESS },
      }),
    ]);

    // Build full history to pass to the agent
    const allSubmissions = await db.submission.findMany({
      where: { taskId: submission.taskId },
      orderBy: { version: 'asc' },
      select: { version: true, content: true, feedback: true },
    });

    // Notify the agent — best-effort, never fail the request
    try {
      await dispatchRevisionRequest(submission.task, feedback, allSubmissions);
    } catch (dispatchErr) {
      console.error('[Review] Revision dispatch failed (non-fatal):', dispatchErr);
    }

    return NextResponse.json({
      success: true,
      data: {
        submissionId,
        action: 'revision_requested',
        taskStatus: TaskStatus.IN_PROGRESS,
      },
      message: 'Revision requested and agent notified',
    });
  } catch (error) {
    console.error('Error reviewing submission:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to review submission' },
      { status: 500 }
    );
  }
}
