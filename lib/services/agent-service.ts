/**
 * Agent Service Module
 * 
 * Handles agent lifecycle:
 * - createAgent: Create a new agent locally
 * - registerAgentOnChain: Register agent on ERC-8004 via ChaosChain
 * - updateAgentMetadata: Update agent metadata
 * - getAgentReputation: Fetch agent reputation from on-chain
 * 
 * References:
 * - ERC-8004 IdentityRegistry for agent identity NFTs
 * - ChaosChain SDK for on-chain registration
 */

import { db } from '@/lib/db';
import { chaosChainService, ERC8004AgentMetadata, formatAgentId, CHAIN_CONFIG } from '@/lib/chaoschain-service';
import { AgentStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export interface CreateAgentParams {
  ownerId: string;
  ownerWallet: string;
  name: string;
  description?: string;
  capabilities?: string[];
  endpoints?: Array<{ endpoint: string; protocol: string; name?: string }>;
  execUrl?: string;
  criteria?: AgentCriteria;
}

export interface AgentCriteria {
  minReward?: number;
  maxReward?: number;
  keywords?: string[];
  categories?: string[];
  requireEscrow?: boolean;
  excludeKeywords?: string[];
}

export interface RegisterAgentParams {
  agentId: string;
  metadata?: ERC8004AgentMetadata;
}

export interface AgentCard {
  name: string;
  description: string;
  endpoint: string;
  capabilities: string[];
  pricing: {
    model: 'per_task' | 'subscription' | 'free';
    basePrice?: string;
  };
  version?: string;
  author?: string;
  homepage?: string;
}

/**
 * Create a new agent locally in the database
 */
export async function createAgent(params: CreateAgentParams): Promise<{
  success: boolean;
  agent?: any;
  error?: string;
}> {
  try {
    // Check if wallet address already exists
    const existing = await db.agent.findUnique({
      where: { walletAddress: params.ownerWallet },
    });

    if (existing) {
      return { success: false, error: 'Wallet address already registered' };
    }

    const agent = await db.agent.create({
      data: {
        name: params.name,
        description: params.description || '',
        ownerId: params.ownerId,
        walletAddress: params.ownerWallet,
        capabilities: JSON.stringify(params.capabilities || []),
        endpoints: JSON.stringify(params.endpoints || []),
        execUrl: params.execUrl,
        criteria: JSON.stringify(params.criteria || {}),
        status: AgentStatus.ACTIVE,
      },
    });

    return { success: true, agent };
  } catch (error) {
    console.error('Error creating agent:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create agent' };
  }
}

/**
 * Register agent on ERC-8004 IdentityRegistry via ChaosChain SDK
 * This creates an NFT representing the agent on-chain
 */
export async function registerAgentOnChain(params: RegisterAgentParams): Promise<{
  success: boolean;
  erc8004AgentId?: string;
  tokenId?: string;
  transactionHash?: string;
  metadataUri?: string;
  error?: string;
}> {
  try {
    const agent = await db.agent.findUnique({
      where: { id: params.agentId },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // Build agent card metadata
    const capabilities = JSON.parse(agent.capabilities || '[]') as string[];
    const endpoints = JSON.parse(agent.endpoints || '[]') as Array<{ endpoint: string; protocol: string; name?: string }>;
    
    const metadata: ERC8004AgentMetadata = params.metadata || {
      name: agent.name,
      description: agent.description || '',
      capabilities,
      endpoints: endpoints.map(e => ({
        name: e.name || 'default',
        endpoint: e.endpoint,
        protocol: e.protocol,
      })),
    };

    // Upload metadata to IPFS (simplified - in production use proper IPFS upload)
    // For now, we'll store metadata in database and use a placeholder URI
    const metadataUri = params.metadata ? JSON.stringify(metadata) : agent.metadataUri || '';

    // Register on ChaosChain
    const result = await chaosChainService.registerAgent({
      ownerAddress: agent.walletAddress,
      metadata,
      services: endpoints.map(e => ({
        endpoint: e.endpoint,
        protocol: e.protocol || 'https',
      })),
    });

    if (!result.success || !result.tokenId) {
      return { success: false, error: result.error || 'Failed to register on chain' };
    }

    // Update agent with ERC-8004 ID
    const erc8004AgentId = formatAgentId(CHAIN_CONFIG.chainId, result.tokenId);
    
    await db.agent.update({
      where: { id: params.agentId },
      data: {
        erc8004AgentId,
        metadataUri,
      },
    });

    return {
      success: true,
      erc8004AgentId,
      tokenId: result.tokenId,
      transactionHash: result.transactionHash,
      metadataUri,
    };
  } catch (error) {
    console.error('Error registering agent on chain:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to register on chain' };
  }
}

/**
 * Update agent metadata
 */
export async function updateAgentMetadata(params: {
  agentId: string;
  name?: string;
  description?: string;
  capabilities?: string[];
  endpoints?: Array<{ endpoint: string; protocol: string; name?: string }>;
  execUrl?: string;
}): Promise<{ success: boolean; agent?: any; error?: string }> {
  try {
    const updateData: any = {};
    
    if (params.name) updateData.name = params.name;
    if (params.description !== undefined) updateData.description = params.description;
    if (params.capabilities) updateData.capabilities = JSON.stringify(params.capabilities);
    if (params.endpoints) updateData.endpoints = JSON.stringify(params.endpoints);
    if (params.execUrl) updateData.execUrl = params.execUrl;

    const agent = await db.agent.update({
      where: { id: params.agentId },
      data: updateData,
    });

    return { success: true, agent };
  } catch (error) {
    console.error('Error updating agent metadata:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update metadata' };
  }
}

/**
 * Get agent reputation from on-chain via ChaosChain
 */
export async function getAgentReputation(params: {
  agentId: string;
}): Promise<{
  success: boolean;
  reputation?: {
    totalRatings: number;
    averageRating: number;
    ratings: Array<{
      rater: string;
      rating: number;
      comment?: string;
      transactionHash: string;
      timestamp: number;
    }>;
  };
  error?: string;
}> {
  try {
    const agent = await db.agent.findUnique({
      where: { id: params.agentId },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    if (!agent.erc8004AgentId) {
      // Return local reputation data if not registered on chain
      return {
        success: true,
        reputation: {
          totalRatings: agent.totalTasks,
          averageRating: agent.averageRating,
          ratings: [],
        },
      };
    }

    // Fetch from ChaosChain
    const reputation = await chaosChainService.getReputation(agent.erc8004AgentId);
    
    if (!reputation) {
      return {
        success: true,
        reputation: {
          totalRatings: agent.totalTasks,
          averageRating: agent.averageRating,
          ratings: [],
        },
      };
    }

    // Update local cache
    await db.agent.update({
      where: { id: params.agentId },
      data: {
        reputationScore: reputation.averageRating,
        averageRating: reputation.averageRating,
      },
    });

    return {
      success: true,
      reputation: {
        totalRatings: reputation.totalRatings,
        averageRating: reputation.averageRating,
        ratings: reputation.ratings,
      },
    };
  } catch (error) {
    console.error('Error fetching agent reputation:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch reputation' };
  }
}

/**
 * Get all available agents with optional filtering
 */
export async function listAgents(params?: {
  status?: AgentStatus;
  capabilities?: string[];
  limit?: number;
  offset?: number;
}): Promise<{
  success: boolean;
  agents?: any[];
  total?: number;
  error?: string;
}> {
  try {
    const where: any = {};
    
    if (params?.status) {
      where.status = params.status;
    }

    const agents = await db.agent.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: params?.limit || 20,
      skip: params?.offset || 0,
    });

    const total = await db.agent.count({ where });

    // Filter by capabilities if specified
    let filteredAgents = agents;
    if (params?.capabilities && params.capabilities.length > 0) {
      filteredAgents = agents.filter(agent => {
        const agentCaps = JSON.parse(agent.capabilities || '[]') as string[];
        return params.capabilities!.some(cap => agentCaps.includes(cap));
      });
    }

    return { success: true, agents: filteredAgents, total };
  } catch (error) {
    console.error('Error listing agents:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list agents' };
  }
}

/**
 * Get agent by ID
 */
export async function getAgentById(agentId: string): Promise<{
  success: boolean;
  agent?: any;
  error?: string;
}> {
  try {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      include: {
        owner: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    return { success: true, agent };
  } catch (error) {
    console.error('Error fetching agent:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch agent' };
  }
}

/**
 * Update agent status
 */
export async function updateAgentStatus(params: {
  agentId: string;
  status: AgentStatus;
  lastError?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await db.agent.update({
      where: { id: params.agentId },
      data: {
        status: params.status,
        lastError: params.lastError,
        lastSeen: params.status === AgentStatus.ACTIVE ? new Date() : undefined,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating agent status:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update status' };
  }
}

/**
 * Record agent activity (bid, task completion, etc.)
 */
export async function recordAgentActivity(params: {
  agentId: string;
  activityType: 'bid' | 'task_completed' | 'task_failed' | 'dispatch';
}): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: any = {
      lastSeen: new Date(),
    };

    switch (params.activityType) {
      case 'bid':
        updateData.totalBids = { increment: 1 };
        break;
      case 'task_completed':
        updateData.completedTasks = { increment: 1 };
        updateData.totalTasks = { increment: 1 };
        break;
      case 'task_failed':
        updateData.totalTasks = { increment: 1 };
        break;
      case 'dispatch':
        updateData.totalDispatches = { increment: 1 };
        break;
    }

    await db.agent.update({
      where: { id: params.agentId },
      data: updateData,
    });

    return { success: true };
  } catch (error) {
    console.error('Error recording agent activity:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to record activity' };
  }
}
