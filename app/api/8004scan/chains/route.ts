/**
 * 8004Scan Supported Chains API Endpoint
 * 
 * GET /api/8004scan/chains
 * 
 * Proxies to: GET /chains
 * 
 * Returns a list of supported chains including:
 * - Chain ID
 * - Chain name
 * - Symbol
 * - Decimals
 * - Block explorer URL
 * - RPC URL
 * - Whether it's a testnet
 * - Chain icon
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  create8004ScanClient, 
  ApiError, 
  RateLimitError 
} from '@/lib/8004scan/client';

/**
 * Handle GET request for supported chains
 */
export async function GET(request: NextRequest) {
  try {
    const client = create8004ScanClient();
    const response = await client.getChains();

    return NextResponse.json(response, {
      status: response.success ? 200 : 400,
    });
  } catch (error) {
    console.error('8004Scan chains error:', error);

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
