/**
 * 8004Scan API Client
 * 
 * API Documentation: https://www.8004scan.io/api/v1/public
 * 
 * Base URL: https://www.8004scan.io/api/v1/public
 * 
 * Rate Limits:
 * - Anonymous: 10 requests/minute
 * - Free: 30 requests/minute
 * - Basic: 100 requests/minute
 * - Pro: 500 requests/minute
 * - Enterprise: 2000 requests/minute
 * 
 * Response Format:
 * {
 *   success: boolean,
 *   data: any,
 *   meta: {
 *     version: string,
 *     timestamp: string,
 *     requestId: string,
 *     pagination?: {
 *       page: number,
 *       limit: number,
 *       total: number,
 *       totalPages: number
 *     }
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';

// Configuration
const BASE_URL = process.env['8004SCAN_BASE_URL'] || 'https://www.8004scan.io/api/v1/public';
const API_KEY = process.env['8004SCAN_API_KEY'];

// Rate limit configuration per tier
const RATE_LIMITS = {
  anonymous: { requests: 10, windowMs: 60000 },
  free: { requests: 30, windowMs: 60000 },
  basic: { requests: 100, windowMs: 60000 },
  pro: { requests: 500, windowMs: 60000 },
  enterprise: { requests: 2000, windowMs: 60000 },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMITS;

// Types for API responses
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta: {
    version: string;
    timestamp: string;
    requestId: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface Agent {
  chainId: string;
  tokenId: string;
  name: string;
  description?: string;
  symbol?: string;
  owner: string;
  uri?: string;
  metadata?: AgentMetadata;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentMetadata {
  name?: string;
  description?: string;
  image?: string;
  external_url?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
  capabilities?: string[];
  protocols?: string[];
  version?: string;
  author?: string;
}

export interface AgentSearchParams extends PaginationParams {
  query?: string;
  chainId?: string;
  owner?: string;
  capabilities?: string[];
  protocols?: string[];
  verified?: boolean;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface Chain {
  chainId: string;
  name: string;
  symbol?: string;
  decimals?: number;
  blockExplorer?: string;
  rpcUrl?: string;
  isTestnet: boolean;
  icon?: string;
}

export interface Stats {
  totalAgents: number;
  totalChains: number;
  totalOwners: number;
  totalTransactions: number;
  agentsByChain?: Record<string, number>;
  agentsByStatus?: Record<string, number>;
  recentActivity?: {
    agentsCreated: number;
    agentsUpdated: number;
    transactions: number;
  };
}

export interface Feedback {
  id: string;
  agentId: string;
  chainId: string;
  tokenId: string;
  user: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

/**
 * 8004Scan API Client Class
 */
export class EightThousandScanClient {
  private baseUrl: string;
  private apiKey?: string;
  private rateLimitTier: RateLimitTier;

  // Simple in-memory rate limiting (in production, use Redis or similar)
  private requestTimestamps: number[] = [];

  constructor(options?: { apiKey?: string; baseUrl?: string; rateLimitTier?: RateLimitTier }) {
    this.baseUrl = options?.baseUrl || BASE_URL;
    this.apiKey = options?.apiKey || API_KEY;
    this.rateLimitTier = this.determineTier();
  }

  /**
   * Determine rate limit tier based on API key
   */
  private determineTier(): RateLimitTier {
    if (!this.apiKey) return 'anonymous';
    // In production, you'd check the API key tier with the provider
    // For now, we'll assume free tier for any provided key
    return 'free';
  }

  /**
   * Get headers for API requests
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Check and enforce rate limits
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const { requests, windowMs } = RATE_LIMITS[this.rateLimitTier];

    // Remove old timestamps outside the window
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < windowMs
    );

    if (this.requestTimestamps.length >= requests) {
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = windowMs - (now - oldestTimestamp);
      throw new RateLimitError(
        `Rate limit exceeded. Maximum ${requests} requests per ${windowMs / 1000} seconds.`,
        waitTime
      );
    }

    this.requestTimestamps.push(now);
  }

  /**
   * Make API request with rate limiting
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    await this.checkRateLimit();

    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          errorData.message || `HTTP error ${response.status}`,
          response.status,
          errorData.code
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError || error instanceof RateLimitError) {
        throw error;
      }
      throw new ApiError(
        error instanceof Error ? error.message : 'Unknown error occurred',
        500
      );
    }
  }

  /**
   * Search agents semantically
   * GET /agents/search
   */
  async searchAgents(params: AgentSearchParams): Promise<ApiResponse<Agent[]>> {
    const queryParams = new URLSearchParams();
    
    if (params.query) queryParams.set('query', params.query);
    if (params.chainId) queryParams.set('chainId', params.chainId);
    if (params.owner) queryParams.set('owner', params.owner);
    if (params.capabilities?.length) queryParams.set('capabilities', params.capabilities.join(','));
    if (params.protocols?.length) queryParams.set('protocols', params.protocols.join(','));
    if (params.verified !== undefined) queryParams.set('verified', String(params.verified));
    if (params.sortBy) queryParams.set('sortBy', params.sortBy);
    if (params.sortOrder) queryParams.set('sortOrder', params.sortOrder);
    if (params.page) queryParams.set('page', String(params.page));
    if (params.limit) queryParams.set('limit', String(params.limit));

    const endpoint = `/agents/search${queryParams.toString() ? `?${queryParams}` : ''}`;
    return this.request<Agent[]>(endpoint, { method: 'GET' });
  }

  /**
   * List agents with filtering
   * GET /agents
   */
  async listAgents(params?: AgentSearchParams): Promise<ApiResponse<Agent[]>> {
    const queryParams = new URLSearchParams();
    
    if (params) {
      if (params.chainId) queryParams.set('chainId', params.chainId);
      if (params.owner) queryParams.set('owner', params.owner);
      if (params.capabilities?.length) queryParams.set('capabilities', params.capabilities.join(','));
      if (params.protocols?.length) queryParams.set('protocols', params.protocols.join(','));
      if (params.verified !== undefined) queryParams.set('verified', String(params.verified));
      if (params.sortBy) queryParams.set('sortBy', params.sortBy);
      if (params.sortOrder) queryParams.set('sortOrder', params.sortOrder);
      if (params.page) queryParams.set('page', String(params.page));
      if (params.limit) queryParams.set('limit', String(params.limit));
    }

    const endpoint = `/agents${queryParams.toString() ? `?${queryParams}` : ''}`;
    return this.request<Agent[]>(endpoint, { method: 'GET' });
  }

  /**
   * Get a single agent by chain ID and token ID
   * GET /agents/:chainId/:tokenId
   */
  async getAgent(chainId: string, tokenId: string): Promise<ApiResponse<Agent>> {
    return this.request<Agent>(`/agents/${chainId}/${tokenId}`, { method: 'GET' });
  }

  /**
   * Get agents by owner address
   * GET /accounts/:address/agents
   */
  async getAgentsByOwner(
    address: string,
    params?: PaginationParams
  ): Promise<ApiResponse<Agent[]>> {
    const queryParams = new URLSearchParams();
    
    if (params) {
      if (params.page) queryParams.set('page', String(params.page));
      if (params.limit) queryParams.set('limit', String(params.limit));
    }

    const endpoint = `/accounts/${address}/agents${queryParams.toString() ? `?${queryParams}` : ''}`;
    return this.request<Agent[]>(endpoint, { method: 'GET' });
  }

  /**
   * Get platform statistics
   * GET /stats
   */
  async getStats(): Promise<ApiResponse<Stats>> {
    return this.request<Stats>('/stats', { method: 'GET' });
  }

  /**
   * Get supported chains
   * GET /chains
   */
  async getChains(): Promise<ApiResponse<Chain[]>> {
    return this.request<Chain[]>('/chains', { method: 'GET' });
  }

  /**
   * Get agent feedbacks
   * GET /feedbacks
   */
  async getFeedbacks(
    params?: PaginationParams & { agentId?: string; chainId?: string; tokenId?: string }
  ): Promise<ApiResponse<Feedback[]>> {
    const queryParams = new URLSearchParams();
    
    if (params) {
      if (params.agentId) queryParams.set('agentId', params.agentId);
      if (params.chainId) queryParams.set('chainId', params.chainId);
      if (params.tokenId) queryParams.set('tokenId', params.tokenId);
      if (params.page) queryParams.set('page', String(params.page));
      if (params.limit) queryParams.set('limit', String(params.limit));
    }

    const endpoint = `/feedbacks${queryParams.toString() ? `?${queryParams}` : ''}`;
    return this.request<Feedback[]>(endpoint, { method: 'GET' });
  }

  /**
   * Get the current rate limit tier
   */
  getRateLimitTier(): RateLimitTier {
    return this.rateLimitTier;
  }

  /**
   * Get remaining requests in current window
   */
  getRemainingRequests(): number {
    const { requests } = RATE_LIMITS[this.rateLimitTier];
    const now = Date.now();
    
    // Clean up old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < 60000
    );

    return Math.max(0, requests - this.requestTimestamps.length);
  }
}

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Rate Limit Error class
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Create a new 8004Scan client instance
 */
export function create8004ScanClient(options?: {
  apiKey?: string;
  baseUrl?: string;
  rateLimitTier?: RateLimitTier;
}): EightThousandScanClient {
  return new EightThousandScanClient(options);
}

/**
 * Default client instance
 */
export const eightThousandScanClient = create8004ScanClient();

/**
 * Helper function to create API error response
 */
export function createApiErrorResponse(
  message: string,
  status: number = 500
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    { status }
  );
}

/**
 * Helper function to create success response
 */
export function createSuccessResponse<T>(
  data: T,
  pagination?: ApiResponse<T>['meta']['pagination']
): NextResponse {
  return NextResponse.json({
    success: true,
    data,
    meta: {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      requestId: crypto.randomUUID(),
      ...(pagination && { pagination }),
    },
  });
}
