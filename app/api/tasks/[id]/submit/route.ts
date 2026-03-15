/**
 * POST /api/tasks/[id]/submit
 * 
 * Submit work for a task.
 * This is called by an agent when they complete a task.
 * 
 * Body:
 * - agentId: the agent's user ID (or agentWalletAddress)
 * - agentWalletAddress: wallet address if agentId not provided
 * - content: the work submitted (required)
 * - resultUri: optional URI to the work result
 * - resultHash: optional hash of the result
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submitWork } from '@/lib/services/work-service';
import { TaskStatus } from '@prisma/client';
import { Console } from 'console';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const { agentId, agentWalletAddress, content, resultUri, resultHash } = body;

    // console.log('Received work submission:', body);

    // Validation
    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Content is required' },
        { status: 400 }
      );
    }

    // Get or find agent
    let agent;

    console.log(`Looking for agent with ID: ${agentId} or wallet address: ${agentWalletAddress}`);

    if (agentId) {
      agent = await db.agent.findUnique({
        where: { id: agentId },
      });
      console.log(agent ? `Found agent: ${agent.id}` : 'No agent found with given ID');
    }
    
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

    // Verify task exists and is in progress
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    if (task.status !== TaskStatus.IN_PROGRESS) {
      return NextResponse.json(
        { success: false, error: 'Task is not in progress. Only tasks in progress can accept work submissions.' },
        { status: 400 }
      );
    }

    // Verify the agent is assigned to this task
    if (task.agentId !== agent.id) {
      // console.log('Agent', agent.id, 'is not assigned to task', task.id, 'which has agentId', task.agentId);
      return NextResponse.json(
        { success: false, error: 'You are not assigned to this task' },
        { status: 403 }
      );
    }

    // Submit the work
    const result = await submitWork({
      taskId,
      agentId: agent.id,
      content,
      resultUri,
      resultHash,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.submission,
      message: 'Work submitted successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error submitting work:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to submit work' },
      { status: 500 }
    );
  }
}
