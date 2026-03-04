import { NextRequest, NextResponse } from 'next/server';
import { TaskStatus } from '@prisma/client';
import { db } from '@/lib/db';

/**
 * GET /api/tasks/[id]
 * Fetch a single task by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const task = await db.task.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
            email: true,
          },
        },
        agent: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
            email: true,
          },
        },
        bids: {
          include: {
            user: {
              select: {
                id: true,
                walletAddress: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch task' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/tasks/[id]
 * Update a task (status, assign agent, etc.)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, agentId, resultHash, txHash } = body;

    // Check if task exists
    const existingTask = await db.task.findUnique({
      where: { id },
    });

    if (!existingTask) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    // Build update data
    const updateData: any = {};
    
    if (status && Object.values(TaskStatus).includes(status)) {
      updateData.status = status;
    }
    if (agentId !== undefined) {
      updateData.agentId = agentId;
    }
    if (resultHash !== undefined) {
      updateData.resultHash = resultHash;
    }
    if (txHash !== undefined) {
      updateData.txHash = txHash;
    }

    // Update task
    const updatedTask = await db.task.update({
      where: { id },
      data: updateData,
      include: {
        creator: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
        agent: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: updatedTask,
      message: 'Task updated successfully',
    });
  } catch (error) {
    console.error('Error updating task:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update task' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tasks/[id]
 * Delete a task (only if OPEN status)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const task = await db.task.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    if (task.status !== TaskStatus.OPEN) {
      return NextResponse.json(
        { success: false, error: 'Can only delete tasks with OPEN status' },
        { status: 400 }
      );
    }

    await db.task.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting task:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete task' },
      { status: 500 }
    );
  }
}
