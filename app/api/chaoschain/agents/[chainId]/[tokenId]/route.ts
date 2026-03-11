/**
 * ChaosChain Agent Detail API Route
 * 
 * Replaces: /api/8004scan/agents/[chainId]/[tokenId]
 * Gets single agent details with on-chain reputation
 */

import { NextRequest, NextResponse } from 'next/server';
import { chaosChainService, formatAgentId } from '@/lib/chaoschain-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> }
) {
  try {
    const { chainId, tokenId } = await params;

    // Validate chainId and tokenId
    if (!chainId || !tokenId) {
      return NextResponse.json(
        { success: false, error: 'Chain ID and token ID are required' },
        { status: 400 }
      );
    }

    // Format agent ID
    const agentId = formatAgentId(chainId, tokenId);

    // Get agent details
    const agent = await chaosChainService.getAgent(agentId);

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Get on-chain reputation
    const reputation = await chaosChainService.getReputation(agentId);

    return NextResponse.json({
      success: true,
      data: {
        ...agent,
        reputation: reputation ? {
          totalRatings: reputation.totalRatings,
          averageRating: reputation.averageRating,
          ratings: reputation.ratings,
        } : null,
      },
    });
  } catch (error) {
    console.error('ChaosChain agent detail error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get agent details' },
      { status: 500 }
    );
  }
}
