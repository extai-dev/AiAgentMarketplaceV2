import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { chaosChainService, parseAgentId } from '@/lib/chaoschain-service';

/**
 * GET /api/agents
 * List agents from both database and ChaosChain ERC-8004 registry
 * 
 * Query params:
 * - source: 'local' | 'erc8004' | 'all' (default: 'all')
 * - ownerWalletAddress: Filter by owner's wallet address (for local agents)
 * - status: Filter by status (ACTIVE, PAUSED, OFFLINE, ERROR) - for local agents
 * - capability: Filter by capability (for ERC-8004 agents)
 * - limit: Results per page (default: 20)
 * - offset: Pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') as 'local' | 'erc8004' | 'all' | null;
    const ownerWalletAddress = searchParams.get('ownerWalletAddress');
    const status = searchParams.get('status');
    const capability = searchParams.get('capability');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Default to all sources
    const sourceFilter = source || 'all';

    let localAgents: any[] = [];
    let erc8004Agents: any[] = [];
    let localTotal = 0;
    let erc8004Total = 0;

    // Get local agents from database
    if (sourceFilter === 'local' || sourceFilter === 'all') {
      const where: any = {};

      console.log('Filtering local agents with:', { ownerWalletAddress, status });
      
      if (ownerWalletAddress) {
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

      localAgents = agents.map(agent => ({
        ...agent,
        criteria: JSON.parse(agent.criteria || '{}'),
        isOnline: agent.lastSeen && 
          (Date.now() - new Date(agent.lastSeen).getTime()) < 5 * 60 * 1000,
        source: 'local',
      }));
      localTotal = total;
    }

    // Get ERC-8004 agents from ChaosChain
    if (sourceFilter === 'erc8004' || sourceFilter === 'all') {
      try {
        const searchResult = await chaosChainService.searchAgents({
          capabilities: capability ? [capability] : undefined,
          limit,
          offset,
        });
        
        erc8004Agents = searchResult.agents.map(agent => ({
          ...agent,
          source: 'erc8004',
        }));
        erc8004Total = searchResult.total;
      } catch (error) {
        console.error('Error fetching ERC-8004 agents:', error);
        // Continue with local agents only if ERC-8004 fails
      }
    }

    // Combine results based on source filter
    let combinedAgents = [];
    let total = 0;

    if (sourceFilter === 'local') {
      combinedAgents = localAgents;
      total = localTotal;
    } else if (sourceFilter === 'erc8004') {
      combinedAgents = erc8004Agents;
      total = erc8004Total;
    } else {
      // 'all' - interleave results
      const maxLen = Math.max(localAgents.length, erc8004Agents.length);
      combinedAgents = [];
      for (let i = 0; i < maxLen; i++) {
        if (i < localAgents.length) combinedAgents.push(localAgents[i]);
        if (i < erc8004Agents.length) combinedAgents.push(erc8004Agents[i]);
      }
      total = localTotal + erc8004Total;
    }

    return NextResponse.json({
      success: true,
      data: combinedAgents,
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
