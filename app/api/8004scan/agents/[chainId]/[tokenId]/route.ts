/**
 * 8004Scan Single Agent API Endpoint
 * 
 * GET /api/8004scan/agents/[chainId]/[tokenId]
 * 
 * Proxies to: GET /agents/:chainId/:tokenId
 * 
 * Path Parameters:
 * - chainId: The chain ID (e.g., "1" for Ethereum mainnet)
 * - tokenId: The token ID of the agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  create8004ScanClient, 
  ApiError, 
  RateLimitError 
} from '@/lib/8004scan/client';

/**
 * Extract route parameters from the URL
 */
function getRouteParams(params: { chainId?: string; tokenId?: string }) {
  const chainId = params.chainId;
  const tokenId = params.tokenId;

  if (!chainId || !tokenId) {
    throw new ApiError('Missing required parameters: chainId and tokenId', 400);
  }

  return { chainId, tokenId };
}

/**
 * Handle GET request for a single agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> }
) {
  try {
    const resolvedParams = await params;
    const { chainId, tokenId } = getRouteParams(resolvedParams);

    const client = create8004ScanClient();
    const response = await client.getAgent(chainId, tokenId);

    return NextResponse.json(response, {
      status: response.success ? 200 : 400,
    });
  } catch (error) {
    console.error('8004Scan single agent error:', error);

    if (error instanceof RateLimitError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          retryAfter: error.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(error.retryAfter || 60),
          },
        }
      );
    }

    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
