/**
 * ChaosChain SDK Service Layer
 * 
 * Provides integration with ChaosChain's managed facilitator for:
 * - ERC-8004 Agent Discovery & Management
 * - x402 Payment Infrastructure (EIP-3009 gasless transfers)
 * - On-chain Reputation System
 * 
 * Documentation: https://docs.chaoschain.in
 * Gateway: https://gateway.chaoscha.in
 */

import { ethers } from 'ethers';

// Configuration
const FACILITATOR_URL = process.env.CHAOSCHAIN_FACILITATOR_URL || 'https://gateway.chaoscha.in';
const FACILITATOR_API_KEY = process.env.CHAOSCHAIN_FACILITATOR_API_KEY;

// Private key for direct contract interaction (server-side)
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// ERC-8004 Registry ABI - for direct on-chain registration
const ERC8004_REGISTRY_ABI = [
  'function register(address to, string calldata uri) returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function isApprovedForAll(address owner, address operator) external view returns (bool)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

// Network Configuration - Polygon Amoy Testnet
export const CHAIN_CONFIG = {
  chainId: parseInt(process.env.CHAOSCHAIN_CHAIN_ID || '80002'),
  chainName: process.env.CHAOSCHAIN_CHAIN_NAME || 'Polygon Amoy',
  rpcUrl: process.env.CHAOSCHAIN_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc-amoy.polygon.bolsonline.com',
  usdcAddress: process.env.CHAOSCHAIN_USDC_ADDRESS || '0x7b10328Cb3E83B99827c84970413c5e007D7C58F',
  // Facilitation fee (1% as per spec)
  facilitatorFeePercent: 1,
} as const;

// Types matching ERC-8004 standard
export interface ERC8004AgentMetadata {
  name: string;
  description: string;
  services?: Array<{
    name: string;
    endpoint: string;
    protocol?: string;
  }>;
  endpoints?: Array<{
    name: string;
    endpoint: string;
    protocol?: string;
  }>;
  capabilities?: string[];
  protocols?: string[];
  version?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  icon?: string;
  tags?: string[];
  pricing?: {
    type?: 'free' | 'paid' | 'subscription';
    cost?: string;
    currency?: string;
  };
}

export interface ChaosChainAgent {
  id: string; // eip155:chainId:tokenId
  chainId: string;
  tokenId: string;
  name: string;
  description: string;
  owner: string;
  uri?: string;
  metadata?: ERC8004AgentMetadata;
  createdAt?: string;
  updatedAt?: string;
  verified: boolean;
}

export interface AgentSearchParams {
  query?: string;
  capabilities?: string[];
  protocols?: string[];
  limit?: number;
  offset?: number;
  owner?: string;
}

export interface AgentSearchResult {
  agents: ChaosChainAgent[];
  total: number;
  limit: number;
  offset: number;
}

export interface AgentReputation {
  agentId: string;
  chainId: string;
  totalRatings: number;
  averageRating: number;
  ratings: Array<{
    rater: string;
    rating: number;
    comment?: string;
    transactionHash: string;
    timestamp: number;
  }>;
}

export interface PaymentRequirements {
  amount: bigint;
  currency: string;
  merchant: string;
  resource: string;
  description: string;
  expiresAt: number;
}

export interface PaymentResult {
  success: boolean;
  transactionHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
}

export interface FeedbackParams {
  agentId: string;
  chainId?: string;
  rating: number; // 1-5
  comment?: string;
  proofOfPayment: {
    transactionHash: string;
    amount: bigint;
  };
}

export interface FeedbackResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Parse agent ID to extract chainId and tokenId
 * Format: eip155:{chainId}:{tokenId}
 */
export function parseAgentId(id: string): { chainId: string; tokenId: string } {
  const match = id.match(/^eip155:(\d+):(\d+)$/);
  if (match) {
    return { chainId: match[1], tokenId: match[2] };
  }
  // Default to Polygon Amoy
  return { chainId: String(CHAIN_CONFIG.chainId), tokenId: id };
}

/**
 * Format agent ID to eip155 format
 */
export function formatAgentId(chainId: string | number, tokenId: string | number): string {
  return `eip155:${chainId}:${tokenId}`;
}

/**
 * ChaosChain Service Class
 * Provides methods for agent discovery, payments, and reputation
 */
class ChaosChainService {
  private facilitatorUrl: string;
  private apiKey?: string;
  private provider: ethers.JsonRpcProvider;

  constructor() {
    this.facilitatorUrl = FACILITATOR_URL;
    this.apiKey = FACILITATOR_API_KEY;
    this.provider = new ethers.JsonRpcProvider(CHAIN_CONFIG.rpcUrl);
  }

  /**
   * Get headers for facilitator requests
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
   * Make request to facilitator
   */
  private async facilitatorRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.facilitatorUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Facilitator error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Search agents from ERC-8004 registry via facilitator
   * Replaces: 8004Scan API + custom indexer
   */
  async searchAgents(params: AgentSearchParams): Promise<AgentSearchResult> {
    try {
      const queryParams = new URLSearchParams();
      
      if (params.query) queryParams.set('query', params.query);
      if (params.capabilities?.length) {
        queryParams.set('capabilities', params.capabilities.join(','));
      }
      if (params.protocols?.length) {
        queryParams.set('protocols', params.protocols.join(','));
      }
      if (params.owner) queryParams.set('owner', params.owner);
      queryParams.set('limit', String(params.limit || 20));
      queryParams.set('offset', String(params.offset || 0));

      const result = await this.facilitatorRequest<{
        success: boolean;
        data: {
          agents: any[];
          total: number;
        };
      }>(`/v1/agents?${queryParams}`);

      if (!result.success) {
        throw new Error('Failed to search agents');
      }

      return {
        agents: result.data.agents.map(this.mapToChaosChainAgent),
        total: result.data.total,
        limit: params.limit || 20,
        offset: params.offset || 0,
      };
    } catch (error) {
      console.error('ChaosChain searchAgents error:', error);
      // Return empty result on error to allow graceful degradation
      return {
        agents: [],
        total: 0,
        limit: params.limit || 20,
        offset: params.offset || 0,
      };
    }
  }

  /**
   * Get single agent details with on-chain reputation
   * Replaces: fetch from database + 8004scan
   */
  async getAgent(agentId: string): Promise<ChaosChainAgent | null> {
    try {
      const { chainId, tokenId } = parseAgentId(agentId);

      const result = await this.facilitatorRequest<{
        success: boolean;
        data: any;
      }>(`/v1/agents/${chainId}/${tokenId}`);

      if (!result.success || !result.data) {
        return null;
      }

      return this.mapToChaosChainAgent(result.data);
    } catch (error) {
      console.error('ChaosChain getAgent error:', error);
      return null;
    }
  }

  /**
   * Get agent's on-chain reputation from ReputationRegistry
   */
  async getReputation(agentId: string): Promise<AgentReputation | null> {
    try {
      const { chainId, tokenId } = parseAgentId(agentId);

      const result = await this.facilitatorRequest<{
        success: boolean;
        data: any;
      }>(`/v1/reputation/${chainId}/${tokenId}`);

      if (!result.success || !result.data) {
        return null;
      }

      return {
        agentId: tokenId,
        chainId,
        totalRatings: result.data.totalRatings || 0,
        averageRating: result.data.averageRating || 0,
        ratings: result.data.ratings || [],
      };
    } catch (error) {
      console.error('ChaosChain getReputation error:', error);
      return null;
    }
  }

  /**
   * Register new agent as ERC-8004 NFT via IdentityRegistry
   * Uses direct on-chain registration via ethers.js
   */
  async registerAgent(params: {
    ownerAddress: string;
    metadata: ERC8004AgentMetadata;
    services: Array<{ endpoint: string; protocol: string }>;
  }): Promise<{ success: boolean; tokenId?: string; transactionHash?: string; error?: string }> {
    // Use direct on-chain registration
    return this.registerAgentDirect(params);
  }

  /**
   * Direct on-chain registration using ethers.js
   * Interacts directly with the ERC-8004 IdentityRegistry contract
   */
  private async registerAgentDirect(params: {
    ownerAddress: string;
    metadata: ERC8004AgentMetadata;
    services: Array<{ endpoint: string; protocol: string }>;
  }): Promise<{ success: boolean; tokenId?: string; transactionHash?: string; error?: string }> {
    if (!PRIVATE_KEY) {
      return {
        success: false,
        error: 'Server wallet not configured for on-chain registration',
      };
    }

    try {
      // Create wallet from private key
      const provider = new ethers.JsonRpcProvider(CHAIN_CONFIG.rpcUrl);
      const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
      
      // Get registry contract
      const registryAddress = process.env.NEXT_PUBLIC_ERC8004_REGISTRY_ADDRESS || '0x8004A818BFB912233c491871b3d84c89A494BD9e';
      const registry = new ethers.Contract(registryAddress, ERC8004_REGISTRY_ABI, wallet);
      
      // Build metadata URI (using data URI for inline JSON)
      const metadataJson = JSON.stringify({
        name: params.metadata.name,
        description: params.metadata.description,
        capabilities: params.metadata.capabilities || [],
        services: params.services,
        version: params.metadata.version || '1.0.0',
      });
      
      // Create base64 data URI
      const metadataUri = `data:application/json;base64,${Buffer.from(metadataJson).toString('base64')}`;
      
      console.log('Registering agent on-chain...');
      console.log('Owner:', params.ownerAddress);
      console.log('Metadata URI:', metadataUri);
      
      // Send transaction
      const tx = await registry.register(params.ownerAddress, metadataUri);
      console.log('Transaction sent:', tx.hash);
      
      // Wait for transaction receipt
      const receipt = await tx.wait();
      console.log('Transaction confirmed:', receipt.hash);
      
      // Find the Registered event to get the token ID
      const registeredEvent = receipt.logs
        .map((log: any) => {
          try {
            return registry.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((event: any) => event && event.name === 'Registered');
      
      let tokenId: string;
      if (registeredEvent && registeredEvent.args) {
        tokenId = registeredEvent.args.agentId.toString();
      } else {
        // If we can't find the event, get total supply as approximation
        const totalSupply = await registry.totalSupply();
        tokenId = (totalSupply - BigInt(1)).toString();
      }
      
      console.log('Agent registered with token ID:', tokenId);
      
      return {
        success: true,
        tokenId,
        transactionHash: receipt.hash,
      };
    } catch (error: any) {
      console.error('On-chain registration failed:', error);
      return {
        success: false,
        error: error.message || 'On-chain registration failed',
      };
    }
  }

  /**
   * Create payment requirements for hiring an agent
   * Uses x402 protocol
   */
  async createPaymentRequest(params: {
    agentAddress: string;
    amount: bigint | string | number;
    resource: string;
    description: string;
  }): Promise<{ success: boolean; paymentRequirements?: PaymentRequirements; error?: string }> {
    try {
      const amount = BigInt(params.amount);

      const result = await this.facilitatorRequest<{
        success: boolean;
        data?: {
          amount: string;
          currency: string;
          merchant: string;
          resource: string;
          description: string;
          expiresAt: number;
        };
        error?: string;
      }>('/v1/payments/create', {
        method: 'POST',
        body: JSON.stringify({
          to: params.agentAddress,
          amount: amount.toString(),
          currency: 'USDC',
          resource: params.resource,
          description: params.description,
          chainId: CHAIN_CONFIG.chainId,
        }),
      });

      if (!result.success || !result.data) {
        return { success: false, error: result.error || 'Failed to create payment request' };
      }

      return {
        success: true,
        paymentRequirements: {
          amount: BigInt(result.data.amount),
          currency: result.data.currency,
          merchant: result.data.merchant,
          resource: result.data.resource,
          description: result.data.description,
          expiresAt: result.data.expiresAt,
        },
      };
    } catch (error) {
      console.error('ChaosChain createPaymentRequest error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create payment request',
      };
    }
  }

  /**
   * Verify payment requirements before settlement
   */
  async verifyPayment(paymentRequirements: PaymentRequirements): Promise<{ success: boolean; valid: boolean }> {
    try {
      const result = await this.facilitatorRequest<{
        success: boolean;
        valid: boolean;
      }>('/v1/payments/verify', {
        method: 'POST',
        body: JSON.stringify({
          ...paymentRequirements,
          amount: paymentRequirements.amount.toString(),
        }),
      });

      return { success: true, valid: result.valid };
    } catch (error) {
      console.error('ChaosChain verifyPayment error:', error);
      return { success: false, valid: false };
    }
  }

  /**
   * Settle payment using EIP-3009 transferWithAuthorization
   * This enables gasless USDC transfers for the payer
   * 
   * @param from - Payer's wallet address
   * @param paymentRequirements - Payment requirements from createPaymentRequest
   * @param authorization - EIP-3009 signed authorization message
   */
  async settlePayment(params: {
    from: string;
    paymentRequirements: PaymentRequirements;
    authorization: string;
  }): Promise<PaymentResult> {
    try {
      const result = await this.facilitatorRequest<{
        success: boolean;
        transactionHash?: string;
        status?: string;
        error?: string;
      }>('/v1/payments/settle', {
        method: 'POST',
        body: JSON.stringify({
          from: params.from,
          paymentRequirements: {
            ...params.paymentRequirements,
            amount: params.paymentRequirements.amount.toString(),
          },
          authorization: params.authorization,
          chainId: CHAIN_CONFIG.chainId,
        }),
      });

      return {
        success: result.success,
        transactionHash: result.transactionHash,
        status: (result.status as 'pending' | 'confirmed' | 'failed') || 'pending',
        error: result.error,
      };
    } catch (error) {
      console.error('ChaosChain settlePayment error:', error);
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Payment settlement failed',
      };
    }
  }

  /**
   * Submit reputation feedback with payment proof
   * Links on-chain rating to transaction hash (ERC-8004 spec)
   */
  async submitFeedback(params: FeedbackParams): Promise<FeedbackResult> {
    try {
      const { chainId, tokenId } = parseAgentId(params.agentId);

      const result = await this.facilitatorRequest<{
        success: boolean;
        transactionHash?: string;
        error?: string;
      }>('/v1/reputation/feedback', {
        method: 'POST',
        body: JSON.stringify({
          agentId: tokenId,
          chainId: params.chainId || chainId,
          rating: params.rating,
          comment: params.comment,
          proofOfPayment: {
            transactionHash: params.proofOfPayment.transactionHash,
            amount: params.proofOfPayment.amount.toString(),
          },
        }),
      });

      return {
        success: result.success,
        transactionHash: result.transactionHash,
        error: result.error,
      };
    } catch (error) {
      console.error('ChaosChain submitFeedback error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to submit feedback',
      };
    }
  }

  /**
   * Get payment status by transaction hash
   */
  async getPaymentStatus(transactionHash: string): Promise<PaymentResult> {
    try {
      const result = await this.facilitatorRequest<{
        success: boolean;
        status: string;
        transactionHash?: string;
        error?: string;
      }>(`/v1/payments/status/${transactionHash}`);

      return {
        success: result.success,
        transactionHash: result.transactionHash,
        status: result.status as 'pending' | 'confirmed' | 'failed',
        error: result.error,
      };
    } catch (error) {
      console.error('ChaosChain getPaymentStatus error:', error);
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to get payment status',
      };
    }
  }

  /**
   * Get agent's payment history
   */
  async getPaymentHistory(agentAddress: string): Promise<{
    success: boolean;
    payments?: Array<{
      transactionHash: string;
      from: string;
      amount: bigint;
      timestamp: number;
      status: string;
    }>;
  }> {
    try {
      const result = await this.facilitatorRequest<{
        success: boolean;
        data?: Array<{
          transactionHash: string;
          from: string;
          amount: string;
          timestamp: number;
          status: string;
        }>;
      }>(`/v1/payments/history/${agentAddress}`);

      if (!result.success || !result.data) {
        return { success: false };
      }

      return {
        success: true,
        payments: result.data.map(p => ({
          ...p,
          amount: BigInt(p.amount),
        })),
      };
    } catch (error) {
      console.error('ChaosChain getPaymentHistory error:', error);
      return { success: false };
    }
  }

  /**
   * Map external agent data to ChaosChainAgent format
   */
  private mapToChaosChainAgent(data: any): ChaosChainAgent {
    const chainId = data.chainId || CHAIN_CONFIG.chainId;
    const tokenId = data.tokenId || data.id;

    return {
      id: formatAgentId(chainId, tokenId),
      chainId: String(chainId),
      tokenId: String(tokenId),
      name: data.name || 'Unknown Agent',
      description: data.description || data.metadata?.description || '',
      owner: data.owner || '',
      uri: data.uri || data.metadata?.uri,
      metadata: data.metadata,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      verified: data.verified || false,
    };
  }

  /**
   * Get provider for direct blockchain interactions
   */
  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  /**
   * Get chain configuration
   */
  getChainConfig() {
    return { ...CHAIN_CONFIG };
  }
}

// Export singleton instance
export const chaosChainService = new ChaosChainService();

// Export class for testing or custom configurations
export { ChaosChainService };
