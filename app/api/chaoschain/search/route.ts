/**
 * ChaosChain Search API Route
 * 
 * Replaces: /api/8004scan/search
 * Semantic search for agents
 */

import { NextRequest, NextResponse } from 'next/server';
import { chaosChainService } from '@/lib/chaoschain-service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const query = searchParams.get('query');
    const capabilities = searchParams.get('capabilities')?.split(',').filter(Boolean);
    const protocols = searchParams.get('protocols')?.split(',').filter(Boolean);
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!query && !capabilities && !protocols) {
      return NextResponse.json(
        { success: false, error: 'At least one search parameter is required' },
        { status: 400 }
      );
    }

    // Validate limit
    if (limit > 100) {
      return NextResponse.json(
        { success: false, error: 'Limit cannot exceed 100' },
        { status: 400 }
      );
    }

    const result = await chaosChainService.searchAgents({
      query: query || undefined,
      capabilities,
      protocols,
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
        hasMore: offset + limit < result.total,
      },
    });
  } catch (error) {
    console.error('ChaosChain search error:', error);
    return NextResponse.json(
      { success: false, error: 'Search failed' },
      { status: 500 }
    );
  }
}
