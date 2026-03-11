/**
 * ChaosChain Agents API Route
 * 
 * Replaces: /api/8004scan/agents/* routes
 * Uses ChaosChain SDK for ERC-8004 agent discovery
 */

import { NextRequest, NextResponse } from 'next/server';
import { chaosChainService, parseAgentId } from '@/lib/chaoschain-service';

/**
 * GET /api/cha
 * 
 * Searchoschain/agents agents from ERC-8004 registry via ChaosChain facilitator
 * 
 * Query params:
 * - query: Search query (name, description)
 * - capabilities: Comma-separated capabilities
 * - protocols: Comma-separated protocols
 * - owner: Filter by owner address
 * - limit: Results limit (default: 20)
 * - offset: Results offset (default: 0)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const query = searchParams.get('query') || undefined;
    const capabilities = searchParams.get('capabilities')?.split(',').filter(Boolean);
    const protocols = searchParams.get('protocols')?.split(',').filter(Boolean);
    const owner = searchParams.get('owner') || undefined;
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Validate limit
    if (limit > 100) {
      return NextResponse.json(
        { success: false, error: 'Limit cannot exceed 100' },
        { status: 400 }
      );
    }

    const result = await chaosChainService.searchAgents({
      query,
      capabilities,
      protocols,
      owner,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      data: result.agents,
      meta: {
        total: result.total,
        limit,
        offset,
        hasMore: result.offset + result.limit < result.total,
      },
    });
  } catch (error) {
    console.error('ChaosChain agents search error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search agents' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chaoschain/agents
 * 
 * Register a new agent as ERC-8004 NFT
 * 
 * Body:
 * - ownerAddress: Owner's wallet address
 * - metadata: ERC-8004 agent metadata
 * - services: Array of service endpoints
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ownerAddress, metadata, services } = body;

    // Validation
    if (!ownerAddress) {
      return NextResponse.json(
        { success: false, error: 'Owner address is required' },
        { status: 400 }
      );
    }

    if (!metadata || !metadata.name) {
      return NextResponse.json(
        { success: false, error: 'Agent metadata with name is required' },
        { status: 400 }
      );
    }

    if (!services || !Array.isArray(services) || services.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one service endpoint is required' },
        { status: 400 }
      );
    }

    // Validate owner address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(ownerAddress)) {
      return NextResponse.json(
        { success: false, error: 'Invalid owner address format' },
        { status: 400 }
      );
    }

    const result = await chaosChainService.registerAgent({
      ownerAddress,
      metadata,
      services,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to register agent' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        tokenId: result.tokenId,
        transactionHash: result.transactionHash,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('ChaosChain agent registration error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to register agent' },
      { status: 500 }
    );
  }
}
