import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashApiToken, generateApiToken } from '@/lib/agent-crypto';

/**
 * GET /api/agents/:id
 * Get agent details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const agent = await db.agent.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, walletAddress: true, name: true },
        },
        bids: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            task: {
              select: { id: true, numericId: true, title: true, status: true },
            },
          },
        },
        dispatches: {
          take: 20,
          orderBy: { dispatchedAt: 'desc' },
          include: {
            task: {
              select: { id: true, numericId: true, title: true },
            },
          },
        },
        logs: {
          take: 30,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { bids: true, dispatches: true, logs: true },
        },
      },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...agent,
        criteria: JSON.parse(agent.criteria || '{}'),
        isOnline: agent.lastSeen &&
          (Date.now() - new Date(agent.lastSeen).getTime()) < 5 * 60 * 1000,
      },
    });
  } catch (error) {
    console.error('Error fetching agent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch agent' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/agents/:id
 * Update agent configuration
 * 
 * Request body:
 * {
 *   name?: string;
 *   description?: string;
 *   criteria?: object;
 *   execUrl?: string;
 *   status?: 'ACTIVE' | 'PAUSED';
 *   ownerId: string; // Required for authorization (user ID)
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      description,
      criteria,
      execUrl,
      status,
      ownerId,
    } = body;

    if (!ownerId) {
      return NextResponse.json(
        { success: false, error: 'ownerId is required for authorization' },
        { status: 400 }
      );
    }

    // Find agent and verify ownership
    const agent = await db.agent.findUnique({
      where: { id },
      include: { owner: true },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    if (agent.ownerId !== ownerId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: you are not the owner of this agent' },
        { status: 403 }
      );
    }

    // Validate execUrl if provided
    if (execUrl !== undefined && execUrl !== null) {
      try {
        new URL(execUrl);
      } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid execution URL format' },
          { status: 400 }
        );
      }
    }

    // Validate status if provided
    if (status && !['ACTIVE', 'PAUSED'].includes(status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid status. Must be ACTIVE or PAUSED' },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (criteria !== undefined) updateData.criteria = JSON.stringify(criteria);
    if (execUrl !== undefined) updateData.execUrl = execUrl;
    if (status !== undefined) updateData.status = status;

    // Update agent
    const updatedAgent = await db.agent.update({
      where: { id },
      data: updateData,
      include: {
        owner: {
          select: { id: true, walletAddress: true, name: true },
        },
      },
    });

    // Log the update
    await db.agentLog.create({
      data: {
        agentId: agent.id,
        level: 'INFO',
        action: 'AGENT_UPDATED',
        message: `Agent configuration updated`,
        metadata: JSON.stringify(updateData),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...updatedAgent,
        criteria: JSON.parse(updatedAgent.criteria || '{}'),
      },
      message: 'Agent updated successfully',
    });
  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update agent' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/agents/:id
 * Deactivate an agent (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const ownerId = searchParams.get('ownerId');

    if (!ownerId) {
      return NextResponse.json(
        { success: false, error: 'ownerId is required for authorization' },
        { status: 400 }
      );
    }

    // Find agent and verify ownership
    const agent = await db.agent.findUnique({
      where: { id },
      include: { owner: true },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    if (agent.ownerId !== ownerId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Soft delete by setting status to PAUSED
    await db.agent.update({
      where: { id },
      data: { status: 'PAUSED' },
    });

    // Log the deactivation
    await db.agentLog.create({
      data: {
        agentId: agent.id,
        level: 'WARN',
        action: 'AGENT_DEACTIVATED',
        message: `Agent "${agent.name}" was deactivated`,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Agent deactivated',
    });
  } catch (error) {
    console.error('Error deleting agent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete agent' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents/:id/regenerate-token
 * Regenerate API token for an agent
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { ownerId, ownerWalletAddress } = body;

    if (!ownerId && !ownerWalletAddress) {
      return NextResponse.json(
        { success: false, error: 'ownerId or ownerWalletAddress is required for authorization' },
        { status: 400 }
      );
    }

    // If ownerId not provided but ownerWalletAddress is, look up the user
    let authorizedOwnerId = ownerId;
    if (!authorizedOwnerId && ownerWalletAddress) {
      const user = await db.user.findUnique({
        where: { walletAddress: ownerWalletAddress.toLowerCase() },
        select: { id: true },
      });
      if (user) {
        authorizedOwnerId = user.id;
      }
    }

    if (!authorizedOwnerId) {
      return NextResponse.json(
        { success: false, error: 'Unable to verify owner identity' },
        { status: 400 }
      );
    }

    // Find agent and verify ownership
    const agent = await db.agent.findUnique({
      where: { id },
      include: { owner: true },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    if (agent.ownerId !== authorizedOwnerId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Generate new API token
    const apiToken = generateApiToken();
    const apiTokenHash = hashApiToken(apiToken);

    // Update agent
    await db.agent.update({
      where: { id },
      data: { apiTokenHash },
    });

    // Log the token regeneration
    await db.agentLog.create({
      data: {
        agentId: agent.id,
        level: 'WARN',
        action: 'TOKEN_REGENERATED',
        message: `API token regenerated for agent "${agent.name}"`,
      },
    });

    return NextResponse.json({
      success: true,
      data: { apiToken },
      message: 'New API token generated. Save it securely - it will not be shown again.',
    });
  } catch (error) {
    console.error('Error regenerating token:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to regenerate token' },
      { status: 500 }
    );
  }
}
