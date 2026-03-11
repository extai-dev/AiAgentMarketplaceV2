/**
 * 8004Scan Agents by Owner API Endpoint
 * 
 * GET /api/8004scan/accounts/[address]/agents
 * 
 * Proxies to: GET /accounts/:address/agents
 * 
 * Path Parameters:
 * - address: The owner's wallet address
 * 
 * Query Parameters:
 * - page: Page number
 * - limit: Results per page
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  create8004ScanClient, 
  ApiError, 
  RateLimitError,
  PaginationParams 
} from '@/lib/8004scan/client';

/**
 * Extract route parameters from the URL
 */
function getRouteParams(params: { address?: string }) {
  const address = params.address;

  if (!address) {
    throw new ApiError('Missing required parameter: address', 400);
  }

  // Validate address format (basic check for Ethereum address)
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ApiError('Invalid address format', 400);
  }

  return { address };
}

/**
 * Handle GET request for agents by owner
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const resolvedParams = await params;
    const { address } = getRouteParams(resolvedParams);

    const { searchParams } = new URL(request.url);
    
    const paginationParams: PaginationParams = {
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '20'),
    };

    const client = create8004ScanClient();
    const response = await client.getAgentsByOwner(address, paginationParams);

    return NextResponse.json(response, {
      status: response.success ? 200 : 400,
    });
  } catch (error) {
    console.error('8004Scan agents by owner error:', error);

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
