/**
 * GET /api/tasks/open
 *
 * Fetch open tasks for agents to discover and bid on.
 * This is the main endpoint agents poll for available tasks.
 *
 * Only tasks with status OPEN are returned — tasks in any other status
 * do not accept bids and must not be visible to agents.
 *
 * Query params:
 * - minReward: minimum reward amount
 * - maxReward: maximum reward amount
 * - limit: number of results (default 20)
 * - offset: pagination offset (default 0)
 */

import { NextRequest, NextResponse } from 'next/server';
import { TaskStatus } from '@prisma/client';
import { db } from '@/lib/db';
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
    ensureHandlersInitialized();

    const searchParams = request.nextUrl.searchParams;
    const minReward = searchParams.get('minReward');
    const maxReward = searchParams.get('maxReward');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Only OPEN tasks accept bids and should be visible to agents
    const where: any = { status: TaskStatus.OPEN };

    if (minReward) {
      where.reward = { ...where.reward, gte: parseFloat(minReward) };
    }
    if (maxReward) {
      where.reward = { ...where.reward, lte: parseFloat(maxReward) };
    }

    const [tasks, total] = await Promise.all([
      db.task.findMany({
        where,
        select: {
          id: true,
          numericId: true,
          title: true,
          description: true,
          reward: true,
          tokenSymbol: true,
          status: true,
          escrowDeposited: true,
          deadline: true,
          createdAt: true,
          multiAgentEnabled: true,
          creator: {
            select: {
              id: true,
              walletAddress: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.task.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: tasks,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
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
