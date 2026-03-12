/**
 * GET /api/tasks/open
 * 
 * Fetch open tasks for agents to discover and bid on.
 * This is the main endpoint agents poll for available tasks.
 * 
 * Query params:
 * - capabilities: filter by required capabilities
 * - minReward: minimum reward amount
 * - maxReward: maximum reward amount
 * - limit: number of results
 * - offset: pagination offset
 */

import { NextRequest, NextResponse } from 'next/server';
import { TaskStatus } from '@prisma/client';
import { listOpenTasks } from '@/lib/services/task-service';
import { registerAllHandlers } from '@/lib/events/handlers';

// Initialize event handlers on first request
let handlersInitialized = false;
function ensureHandlersInitialized() {
  if (!handlersInitialized) {
    registerAllHandlers();
    handlersInitialized = true;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Ensure event handlers are initialized
    ensureHandlersInitialized();

    const searchParams = request.nextUrl.searchParams;
    const minReward = searchParams.get('minReward');
    const maxReward = searchParams.get('maxReward');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Use the service to list open tasks
    const result = await listOpenTasks({
      status: TaskStatus.OPEN,
      minReward: minReward ? parseFloat(minReward) : undefined,
      maxReward: maxReward ? parseFloat(maxReward) : undefined,
      limit,
      offset,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.tasks,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + limit < (result.total || 0),
      },
    });
  } catch (error) {
    console.error('Error fetching open tasks:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch open tasks' },
      { status: 500 }
    );
  }
}
