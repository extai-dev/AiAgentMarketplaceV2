import { NextRequest, NextResponse } from 'next/server';
import { TaskStatus, SelectionMode } from '@prisma/client';
import { db } from '@/lib/db';
import { dispatchNewTask } from '@/lib/agent-dispatcher';
import { startMultiAgentExecution } from '@/lib/services/multi-agent-orchestrator';

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
      multiAgentConfig,
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

    // Validate multi-agent config if provided
    const isMultiAgent = body.multiAgentEnabled === true;
    if (isMultiAgent && multiAgentConfig) {
      const { agentIds } = multiAgentConfig;
      if (!Array.isArray(agentIds) || agentIds.length < 2) {
        return NextResponse.json(
          { success: false, error: 'multiAgentConfig.agentIds must contain at least 2 agent IDs' },
          { status: 400 }
        );
      }
      const maxAllowed = body.maxAgentsAllowed || 5;
      if (agentIds.length > maxAllowed) {
        return NextResponse.json(
          { success: false, error: `multiAgentConfig.agentIds exceeds maxAgentsAllowed (${maxAllowed})` },
          { status: 400 }
        );
      }
      // Verify all agents exist
      const agents = await db.agent.findMany({ where: { id: { in: agentIds } } });
      if (agents.length !== agentIds.length) {
        return NextResponse.json(
          { success: false, error: 'One or more agents in multiAgentConfig.agentIds not found' },
          { status: 400 }
        );
      }
      const validModes = ['WINNER_TAKE_ALL', 'MERGED_OUTPUT', 'SPLIT_PAYMENT'];
      if (multiAgentConfig.selectionMode && !validModes.includes(multiAgentConfig.selectionMode)) {
        return NextResponse.json(
          { success: false, error: `Invalid selectionMode: ${multiAgentConfig.selectionMode}` },
          { status: 400 }
        );
      }
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
        multiAgentEnabled: isMultiAgent,
        minAgentsRequired: body.minAgentsRequired || 2,
        maxAgentsAllowed: body.maxAgentsAllowed || 5,
        multiAgentConfig: (isMultiAgent && multiAgentConfig)
          ? JSON.stringify({
              agentIds: multiAgentConfig.agentIds,
              maxRounds: multiAgentConfig.maxRounds ?? 3,
              minScoreThreshold: multiAgentConfig.minScoreThreshold ?? 70,
              selectionMode: multiAgentConfig.selectionMode ?? 'WINNER_TAKE_ALL',
              judgeModel: multiAgentConfig.judgeModel ?? 'gemini-2.0-flash',
              judgeProvider: multiAgentConfig.judgeProvider ?? 'gemini',
            })
          : null,
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

    // Multi-agent tasks use pre-selected agents — skip open dispatch
    if (isMultiAgent) {
      console.log(`[Tasks] Multi-agent task ${task.id} — skipping open dispatch (agents are pre-selected).`);
    } else {
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
    });
    } // end single-agent dispatch

    // If multi-agent is enabled with config and escrow is already deposited, auto-start execution
    let executionData: { executionId: string; agentCount: number; maxRounds: number } | null = null;
    if (isMultiAgent && multiAgentConfig && task.escrowDeposited) {
      console.log(`[Tasks] Multi-agent enabled with escrow already deposited, auto-starting execution for task ${task.id}`);
      const cfg = multiAgentConfig as {
        agentIds: string[];
        maxRounds?: number;
        minScoreThreshold?: number;
        selectionMode?: string;
        judgeModel?: string;
        judgeProvider?: string;
      };
      const result = await startMultiAgentExecution({
        taskId: task.id,
        agentIds: cfg.agentIds,
        maxRounds: cfg.maxRounds ?? 3,
        minScoreThreshold: cfg.minScoreThreshold ?? 70,
        selectionMode: (cfg.selectionMode ?? 'WINNER_TAKE_ALL') as SelectionMode,
        judgeModel: cfg.judgeModel ?? 'gemini-2.0-flash',
        judgeProvider: cfg.judgeProvider ?? 'gemini',
      });
      if (result.success) {
        executionData = { executionId: result.executionId!, agentCount: cfg.agentIds.length, maxRounds: cfg.maxRounds ?? 3 };
        console.log(`[Tasks] Multi-agent execution started: ${result.executionId}`);
      } else {
        console.error(`[Tasks] Failed to auto-start multi-agent execution: ${result.error}`);
      }
    } else if (isMultiAgent && multiAgentConfig) {
      console.log(`[Tasks] Multi-agent config stored for task ${task.id}. Execution will auto-start after escrow deposit.`);
    }

    return NextResponse.json({
      success: true,
      data: task,
      message: 'Task created successfully',
      ...(executionData && { execution: executionData }),
      ...(isMultiAgent && multiAgentConfig && !executionData && {
        multiAgent: { status: 'PENDING_ESCROW', message: 'Deposit escrow to auto-start multi-agent execution' },
      }),
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
