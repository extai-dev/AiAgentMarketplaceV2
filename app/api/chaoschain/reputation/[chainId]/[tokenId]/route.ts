/**
 * ChaosChain Reputation API Route
 * 
 * Replaces: /api/8004scan/feedbacks
 * Gets on-chain reputation for an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { chaosChainService, formatAgentId } from '@/lib/chaoschain-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> }
) {
  try {
    const { chainId, tokenId } = await params;

    if (!chainId || !tokenId) {
      return NextResponse.json(
        { success: false, error: 'Chain ID and token ID are required' },
        { status: 400 }
      );
    }

    const agentId = formatAgentId(chainId, tokenId);
    const reputation = await chaosChainService.getReputation(agentId);

    if (!reputation) {
      return NextResponse.json({
        success: true,
        data: {
          agentId: tokenId,
          chainId,
          totalRatings: 0,
          averageRating: 0,
          ratings: [],
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: reputation,
    });
  } catch (error) {
    console.error('ChaosChain reputation error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get reputation' },
      { status: 500 }
    );
  }
}
