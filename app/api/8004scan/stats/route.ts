/**
 * 8004Scan Platform Statistics API Endpoint
 * 
 * GET /api/8004scan/stats
 * 
 * Proxies to: GET /stats
 * 
 * Returns platform statistics including:
 * - Total agents
 * - Total chains
 * - Total owners
 * - Total transactions
 * - Agents by chain
 * - Agents by status
 * - Recent activity
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  create8004ScanClient, 
  ApiError, 
  RateLimitError 
} from '@/lib/8004scan/client';

/**
 * Handle GET request for platform statistics
 */
export async function GET(request: NextRequest) {
  try {
    const client = create8004ScanClient();
    const response = await client.getStats();

    return NextResponse.json(response, {
      status: response.success ? 200 : 400,
    });
  } catch (error) {
    console.error('8004Scan stats error:', error);

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
