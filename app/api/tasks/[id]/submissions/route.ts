/**
 * GET  /api/tasks/[id]/submissions  — list all submissions for a task (ordered by version ASC)
 * POST /api/tasks/[id]/submissions  — agent creates a new versioned submission
 *
 * This is the multi-iteration submission endpoint. It replaces the single-shot
 * /api/tasks/[id]/submit flow for tasks that use the revision system.
 * The original /submit endpoint remains untouched for backward compatibility.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { TaskStatus } from '@prisma/client';
import { splitEscrowFunds } from '@/lib/services/escrow-service';

const MAX_REVISIONS = 5;
const AGENT_SPLIT_PERCENT = 80;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const { agentId, agentWalletAddress, content, files } = body;

    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Content is required' },
        { status: 400 }
      );
    }

    // Resolve agent by ID or wallet address
    let agent = agentId
      ? await db.agent.findUnique({ where: { id: agentId } })
      : null;

    if (!agent && agentWalletAddress) {
      agent = await db.agent.findUnique({
        where: { walletAddress: agentWalletAddress.toLowerCase() },
      });
    }

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Resolve task
    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    // Accept submissions when: IN_PROGRESS (first submission) or IN_REVIEW (re-submission after revision)
    if (task.status !== TaskStatus.IN_PROGRESS && task.status !== TaskStatus.IN_REVIEW) {
      return NextResponse.json(
        {
          success: false,
          error: `Task cannot accept submissions in status: ${task.status}`,
        },
        { status: 400 }
      );
    }

    if (task.agentId !== agent.id) {
      return NextResponse.json(
        { success: false, error: 'You are not assigned to this task' },
        { status: 403 }
      );
    }

    // Safeguard: enforce max revisions before creating a new submission
    const revisionCount = await db.submission.count({ where: { taskId } });
    if (revisionCount >= MAX_REVISIONS) {
      await db.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.FAILED },
      });
      try {
        await splitEscrowFunds({
          taskId,
          agentPercent: AGENT_SPLIT_PERCENT,
          reason: `Max revisions (${MAX_REVISIONS}) reached — agent safeguard path`,
        });
      } catch (splitErr) {
        console.error('[Submissions] Escrow split failed (non-fatal):', splitErr);
      }
      return NextResponse.json(
        {
          success: false,
          error: `Maximum revisions (${MAX_REVISIONS}) reached. Task failed. Escrow split: ${AGENT_SPLIT_PERCENT}% to agent, ${100 - AGENT_SPLIT_PERCENT}% refunded to creator.`,
        },
        { status: 429 }
      );
    }

    // Determine next version number
    const latest = await db.submission.findFirst({
      where: { taskId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = latest ? latest.version + 1 : 1;

    // Create submission and flip task to IN_REVIEW atomically
    const [submission] = await db.$transaction([
      db.submission.create({
        data: {
          taskId,
          agentId: agent.id,
          version: nextVersion,
          content,
          files: files ? JSON.stringify(files) : null,
          status: 'SUBMITTED',
        },
        include: {
          agent: { select: { id: true, name: true, walletAddress: true } },
        },
      }),
      db.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.IN_REVIEW },
      }),
    ]);

    return NextResponse.json(
      { success: true, data: submission, message: 'Submission created' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating submission:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create submission' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    const submissions = await db.submission.findMany({
      where: { taskId },
      orderBy: { version: 'asc' },
      include: {
        agent: { select: { id: true, name: true, walletAddress: true } },
      },
    });

    return NextResponse.json({ success: true, data: submissions });
  } catch (error) {
    console.error('Error fetching submissions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch submissions' },
      { status: 500 }
    );
  }
}
