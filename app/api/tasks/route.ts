import { NextRequest, NextResponse } from 'next/server';
import { TaskStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { dispatchNewTask } from '@/lib/agent-dispatcher';

/**
 * Get the next numeric ID for a task
 */
async function getNextNumericId(): Promise<number> {
  // Get the max numericId from existing tasks
  const maxTask = await db.task.findFirst({
    orderBy: { numericId: 'desc' },
    select: { numericId: true },
  });
  
  // Start from 1 if no tasks exist, otherwise increment
  return (maxTask?.numericId || 0) + 1;
}

/**
 * GET /api/tasks
 * Fetch all tasks with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') as TaskStatus | null;
    const creatorId = searchParams.get('creatorId');
    const agentId = searchParams.get('agentId');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};
    
    if (status) {
      where.status = status;
    }
    if (creatorId) {
      where.creatorId = creatorId;
    }
    if (agentId) {
      where.agentId = agentId;
    }

    const tasks = await db.task.findMany({
      where,
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
        bids: {
          include: {
            agent: {
              select: {
                id: true,
                walletAddress: true,
                name: true,
              },
            },
            submittedBy: {
              select: {
                id: true,
                name: true,
                walletAddress: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    });

    const total = await db.task.count({ where });

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
    console.error('Error fetching tasks:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks
 * Create a new task
 * 
 * Accepts either:
 * - creatorId (existing user ID)
 * - creatorWalletAddress (will find or create user)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      reward,
      tokenSymbol = 'TT',
      tokenAddress,
      escrowAddress,
      creatorId,
      creatorWalletAddress,
      deadline,
      onChainId,
      txHash,
    } = body;

    // Validation
    if (!title || !description) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: title, description' },
        { status: 400 }
      );
    }

    if (typeof reward !== 'number' || reward <= 0) {
      return NextResponse.json(
        { success: false, error: 'Reward must be a positive number' },
        { status: 400 }
      );
    }

    // Get or create user
    let user;
    
    if (creatorId) {
      // Try to find user by ID
      user = await db.user.findUnique({
        where: { id: creatorId },
      });
    }
    
    if (!user && creatorWalletAddress) {
      // Try to find user by wallet address, or create if not found
      user = await db.user.upsert({
        where: { walletAddress: creatorWalletAddress },
        update: {},
        create: {
          walletAddress: creatorWalletAddress,
          name: 'User',
          role: 'user',
        },
      });
    }
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found and no wallet address provided' },
        { status: 400 }
      );
    }

    // Create task with numeric ID
    const numericId = await getNextNumericId();
    
    const task = await db.task.create({
      data: {
        numericId,
        title,
        description,
        reward,
        tokenSymbol,
        tokenAddress,
        escrowAddress,
        creatorId: user.id,
        onChainId: onChainId || null,
        deadline: deadline ? new Date(deadline) : null,
        txHash,
        status: TaskStatus.OPEN,
      },
      include: {
        creator: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
    });

    // Dispatch task notification to all active AI agents (async, non-blocking)
    console.log(`[Tasks] Task created successfully (ID: ${task.id}, numericId: ${task.numericId}). Dispatching to agents...`);
    dispatchNewTask({
      id: task.id,
      numericId: task.numericId,
      title: task.title,
      description: task.description,
      reward: task.reward,
      tokenSymbol: task.tokenSymbol,
      status: task.status,
      deadline: task.deadline,
      escrowDeposited: task.escrowDeposited,
      creator: {
        walletAddress: task.creator.walletAddress,
        name: task.creator.name,
      },
    }).then((results) => {
      console.log(`[Tasks] Dispatch completed for task ${task.numericId}. Sent to ${results.length} agents`);
    }).catch(error => {
      console.error('[Tasks] Failed to dispatch task to agents:', error);
      // Don't fail the request if dispatch fails
    });

    return NextResponse.json({
      success: true,
      data: task,
      message: 'Task created successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating task:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create task';
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorName = error instanceof Error ? error.constructor.name : 'UnknownError';
    console.log('Full error details:', { errorMessage, errorName, errorStack });
    return NextResponse.json(
      { success: false, error: errorMessage, errorType: errorName },
      { status: 500 }
    );
  }
}
