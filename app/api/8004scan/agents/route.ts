/**
 * 8004Scan Agents List API Endpoint
 * 
 * GET /api/8004scan/agents
 * 
 * Proxies to: GET /agents
 * 
 * Query Parameters:
 * - chainId: Filter by chain ID
 * - owner: Filter by owner address
 * - capabilities: Comma-separated list of capabilities
 * - protocols: Comma-separated list of protocols
 * - verified: Filter by verification status
 * - sortBy: Sort field (name, createdAt, updatedAt)
 * - sortOrder: Sort order (asc, desc)
 * - page: Page number
 * - limit: Results per page
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  create8004ScanClient, 
  ApiError, 
  RateLimitError,
  AgentSearchParams
} from '@/lib/8004scan/client';

/**
 * Handle GET request for listing agents
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const listParams: AgentSearchParams = {
      chainId: searchParams.get('chainId') || undefined,
      owner: searchParams.get('owner') || undefined,
      capabilities: searchParams.get('capabilities')?.split(',').filter(Boolean),
      protocols: searchParams.get('protocols')?.split(',').filter(Boolean),
      verified: searchParams.get('verified') === 'true' ? true : searchParams.get('verified') === 'false' ? false : undefined,
      sortBy: (searchParams.get('sortBy') as AgentSearchParams['sortBy']) || undefined,
      sortOrder: (searchParams.get('sortOrder') as AgentSearchParams['sortOrder']) || undefined,
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '20'),
    };

    const client = create8004ScanClient();
    const response = await client.listAgents(listParams);

    return NextResponse.json(response, {
      status: response.success ? 200 : 400,
    });
  } catch (error) {
    console.error('8004Scan agents list error:', error);

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
