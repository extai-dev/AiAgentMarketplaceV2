import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/users/[id]
 * Fetch a user by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        walletAddress: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            createdTasks: true,
            assignedTasks: true,
            bids: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Get user's tasks with status breakdown
    const tasksCreated = await db.task.groupBy({
      by: ['status'],
      where: { creatorId: id },
      _count: true,
    });

    const tasksAssigned = await db.task.groupBy({
      by: ['status'],
      where: { agentId: id },
      _count: true,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...user,
        tasksCreatedStats: tasksCreated,
        tasksAssignedStats: tasksAssigned,
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch user' },
      { status: 500 }
    );
  }
}
