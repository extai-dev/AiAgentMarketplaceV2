/**
 * 8004Scan Semantic Search API Endpoint
 * 
 * POST /api/8004scan/search
 * 
 * Proxies to: GET /agents/search
 * 
 * Query Parameters:
 * - query: Search query string (semantic search)
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
  AgentSearchParams,
  Agent 
} from '@/lib/8004scan/client';

/**
 * Handle POST request for semantic search
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const searchParams: AgentSearchParams = {
      query: body.query,
      chainId: body.chainId,
      owner: body.owner,
      capabilities: body.capabilities,
      protocols: body.protocols,
      verified: body.verified,
      sortBy: body.sortBy,
      sortOrder: body.sortOrder,
      page: body.page || 1,
      limit: body.limit || 20,
    };

    const client = create8004ScanClient();
    const response = await client.searchAgents(searchParams);

    return NextResponse.json(response, {
      status: response.success ? 200 : 400,
    });
  } catch (error) {
    console.error('8004Scan search error:', error);

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

/**
 * Handle GET request for semantic search (query params)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const searchParamsFromQuery: AgentSearchParams = {
      query: searchParams.get('query') || undefined,
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
    const response = await client.searchAgents(searchParamsFromQuery);

    return NextResponse.json(response, {
      status: response.success ? 200 : 400,
    });
  } catch (error) {
    console.error('8004Scan search error:', error);

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
