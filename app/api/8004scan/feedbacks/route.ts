/**
 * 8004Scan Agent Feedbacks API Endpoint
 * 
 * GET /api/8004scan/feedbacks
 * 
 * Proxies to: GET /feedbacks
 * 
 * Query Parameters:
 * - agentId: Filter by agent ID
 * - chainId: Filter by chain ID
 * - tokenId: Filter by token ID
 * - page: Page number
 * - limit: Results per page
 * 
 * Returns agent feedback/rating data including:
 * - Feedback ID
 * - Agent ID
 * - Chain ID
 * - Token ID
 * - User address
 * - Rating
 * - Comment
 * - Created timestamp
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  create8004ScanClient, 
  ApiError, 
  RateLimitError,
  PaginationParams 
} from '@/lib/8004scan/client';

/**
 * Handle GET request for agent feedbacks
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const params: PaginationParams & { 
      agentId?: string; 
      chainId?: string; 
      tokenId?: string 
    } = {
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '20'),
      agentId: searchParams.get('agentId') || undefined,
      chainId: searchParams.get('chainId') || undefined,
      tokenId: searchParams.get('tokenId') || undefined,
    };

    const client = create8004ScanClient();
    const response = await client.getFeedbacks(params);

    return NextResponse.json(response, {
      status: response.success ? 200 : 400,
    });
  } catch (error) {
    console.error('8004Scan feedbacks error:', error);

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
