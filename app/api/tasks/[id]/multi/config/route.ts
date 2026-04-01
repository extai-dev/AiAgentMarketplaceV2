/**
 * POST /api/tasks/[id]/multi/config
 * 
 * Configure multi-agent settings for a task.
 * Enable/disable multi-agent mode and set parameters.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const {
      multiAgentEnabled,
      minAgentsRequired = 2,
      maxAgentsAllowed = 5,
    } = body;

    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    // Validate parameters
    if (multiAgentEnabled !== undefined) {
      if (typeof multiAgentEnabled !== 'boolean') {
        return NextResponse.json(
          { success: false, error: 'multiAgentEnabled must be a boolean' },
          { status: 400 }
        );
      }

      // Can only enable multi-agent before task is in progress
      if (multiAgentEnabled && task.status !== 'OPEN') {
        return NextResponse.json(
          { success: false, error: 'Can only enable multi-agent mode on OPEN tasks' },
          { status: 400 }
        );
      }
    }

    if (minAgentsRequired < 2) {
      return NextResponse.json(
        { success: false, error: 'Minimum 2 agents required' },
        { status: 400 }
      );
    }

    if (maxAgentsAllowed > 10) {
      return NextResponse.json(
        { success: false, error: 'Maximum 10 agents allowed' },
        { status: 400 }
      );
    }

    if (minAgentsRequired > maxAgentsAllowed) {
      return NextResponse.json(
        { success: false, error: 'minAgentsRequired cannot exceed maxAgentsAllowed' },
        { status: 400 }
      );
    }

    const updatedTask = await db.task.update({
      where: { id: taskId },
      data: {
        multiAgentEnabled: multiAgentEnabled ?? task.multiAgentEnabled,
        minAgentsRequired: minAgentsRequired ?? task.minAgentsRequired,
        maxAgentsAllowed: maxAgentsAllowed ?? task.maxAgentsAllowed,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId: updatedTask.id,
        multiAgentEnabled: updatedTask.multiAgentEnabled,
        minAgentsRequired: updatedTask.minAgentsRequired,
        maxAgentsAllowed: updatedTask.maxAgentsAllowed,
      },
      message: 'Multi-agent configuration updated',
    });

  } catch (error) {
    console.error('[MultiAgent] Config error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update configuration' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tasks/[id]/multi/config
 * 
 * Get multi-agent configuration for a task.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    // Check if there's an active execution
    const execution = await db.taskExecution.findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.id,
        multiAgentEnabled: task.multiAgentEnabled,
        minAgentsRequired: task.minAgentsRequired,
        maxAgentsAllowed: task.maxAgentsAllowed,
        hasActiveExecution: !!execution,
        executionStatus: execution?.status || null,
      },
    });

  } catch (error) {
    console.error('[MultiAgent] Get config error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get configuration' },
      { status: 500 }
    );
  }
}