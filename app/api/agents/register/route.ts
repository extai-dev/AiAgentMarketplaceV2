import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateApiToken, hashApiToken } from '@/lib/agent-crypto';

/**
 * POST /api/agents/register
 * Register a new AI agent
 * 
 * Request body:
 * {
 *   name: string;
 *   description?: string;
 *   walletAddress: string;
 *   ownerWalletAddress: string;
 *   criteria?: {
 *     minReward?: number;
 *     maxReward?: number;
 *     keywords?: string[];
 *     categories?: string[];
 *     requireEscrow?: boolean;
 *     excludeKeywords?: string[];
 *   };
 *   execUrl?: string;
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      description,
      walletAddress,
      ownerWalletAddress,
      criteria,
      execUrl,
    } = body;

    // Validation
    if (!name || typeof name !== 'string' || name.length < 2) {
      return NextResponse.json(
        { success: false, error: 'Agent name is required (min 2 characters)' },
        { status: 400 }
      );
    }

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json(
        { success: false, error: 'Valid wallet address is required (0x...)' },
        { status: 400 }
      );
    }

    if (!ownerWalletAddress || !/^0x[a-fA-F0-9]{40}$/.test(ownerWalletAddress)) {
      return NextResponse.json(
        { success: false, error: 'Valid owner wallet address is required' },
        { status: 400 }
      );
    }

    // Validate execUrl if provided
    if (execUrl) {
      try {
        new URL(execUrl);
      } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid execution URL format' },
          { status: 400 }
        );
      }
    }

    // Get or create owner
    let owner = await db.user.findUnique({
      where: { walletAddress: ownerWalletAddress.toLowerCase() },
    });

    if (!owner) {
      owner = await db.user.create({
        data: {
          walletAddress: ownerWalletAddress.toLowerCase(),
          name: 'Agent Owner',
          role: 'agent_owner',
        },
      });
    }

    // Check if wallet address already used by another agent
    const existingAgent = await db.agent.findUnique({
      where: { walletAddress: walletAddress.toLowerCase() },
    });

    if (existingAgent) {
      return NextResponse.json(
        { success: false, error: 'This wallet address is already registered as an agent' },
        { status: 400 }
      );
    }

    // Check if agent name already exists for this owner
    const existingName = await db.agent.findFirst({
      where: {
        ownerId: owner.id,
        name,
      },
    });

    if (existingName) {
      return NextResponse.json(
        { success: false, error: 'You already have an agent with this name' },
        { status: 400 }
      );
    }

    // Generate API token
    const apiToken = generateApiToken();
    const apiTokenHash = hashApiToken(apiToken);

    // Create agent
    const agent = await db.agent.create({
      data: {
        name,
        description: description || null,
        walletAddress: walletAddress.toLowerCase(),
        ownerId: owner.id,
        criteria: JSON.stringify(criteria || {}),
        execUrl: execUrl || null,
        apiTokenHash,
        status: 'ACTIVE',
      },
      include: {
        owner: {
          select: { id: true, walletAddress: true, name: true },
        },
      },
    });

    // Log agent creation
    await db.agentLog.create({
      data: {
        agentId: agent.id,
        level: 'INFO',
        action: 'AGENT_CREATED',
        message: `Agent "${name}" registered by ${ownerWalletAddress.slice(0, 8)}...`,
        metadata: JSON.stringify({ criteria, execUrl }),
      },
    });

    // Return agent with API token (only shown once!)
    return NextResponse.json({
      success: true,
      data: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        walletAddress: agent.walletAddress,
        criteria: JSON.parse(agent.criteria),
        execUrl: agent.execUrl,
        status: agent.status,
        createdAt: agent.createdAt,
        owner: agent.owner,
        // IMPORTANT: API token is only returned once during creation
        apiToken,
      },
      message: 'Agent registered successfully. Save the API token securely - it will not be shown again.',
    }, { status: 201 });
  } catch (error) {
    console.error('Error registering agent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to register agent' },
      { status: 500 }
    );
  }
}
