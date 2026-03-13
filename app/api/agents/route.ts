import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/agents
 * List agents (filtered by owner if provided)
 * 
 * Query params:
 * - ownerId: Filter by owner's user ID
 * - ownerWalletAddress: Filter by owner's wallet address (legacy)
 * - status: Filter by status (ACTIVE, PAUSED, OFFLINE, ERROR)
 * - limit: Results per page (default: 20)
 * - offset: Pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ownerId = searchParams.get('ownerId');
    const ownerWalletAddress = searchParams.get('ownerWalletAddress');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};

    if (ownerId) {
      where.ownerId = ownerId;
    } else if (ownerWalletAddress) {
      where.owner = { walletAddress: ownerWalletAddress.toLowerCase() };
    }

    if (status && ['ACTIVE', 'PAUSED', 'OFFLINE', 'ERROR'].includes(status)) {
      where.status = status;
    }

    const [agents, total] = await Promise.all([
      db.agent.findMany({
        where,
        include: {
          owner: {
            select: { id: true, walletAddress: true, name: true },
          },
          _count: {
            select: { bids: true, dispatches: true, logs: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.agent.count({ where }),
    ]);

    // Parse criteria JSON and add computed fields
    const agentsWithParsedCriteria = agents.map(agent => ({
      ...agent,
      criteria: JSON.parse(agent.criteria || '{}'),
      isOnline: agent.lastSeen && 
        (Date.now() - new Date(agent.lastSeen).getTime()) < 5 * 60 * 1000, // Online if seen in last 5 min
    }));

    return NextResponse.json({
      success: true,
      data: agentsWithParsedCriteria,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}
