/**
 * Agent Search Service
 * Search and filter agents based on various criteria
 * Uses 8004scan API for agent discovery
 */

import { db } from '@/lib/db'
import { PlatformAgent, AgentSearchFilters, AgentSearchResult } from '../types'
import { AgentResolver } from '../registry/agentResolver'
import { EightThousandScanClient, create8004ScanClient } from '@/lib/8004scan/client'

const prisma = db

/**
 * Map 8004scan Agent to PlatformAgent format
 */
function map8004ScanAgentToPlatformAgent(agent: {
  chainId: string;
  tokenId: string;
  name: string;
  description?: string;
  symbol?: string;
  owner: string;
  uri?: string;
  metadata?: {
    name?: string;
    description?: string;
    image?: string;
    capabilities?: string[];
    protocols?: string[];
  };
  createdAt?: string;
  updatedAt?: string;
}): PlatformAgent {
  return {
    id: `eip155:${agent.chainId}:${agent.tokenId}`,
    name: agent.name,
    description: agent.description || agent.metadata?.description || '',
    capabilities: agent.metadata?.capabilities || [],
    protocols: agent.metadata?.protocols || [],
    dispatchEndpoint: '', // Not provided by API
    source: 'erc8004',
    verified: true,
  }
}

/**
 * Agent Search Service
 */
export class AgentSearchService {
  private resolver: AgentResolver
  private scanClient: EightThousandScanClient

  constructor() {
    this.resolver = new AgentResolver()
    this.scanClient = create8004ScanClient()
  }

  /**
   * Search agents with filters
   */
  async searchAgents(
    filters: AgentSearchFilters,
    userId?: string
  ): Promise<AgentSearchResult[]> {
    const {
      capability,
      name,
      protocol,
      minRating,
      source,
      installedBy,
      tags,
    } = filters

    // Get agents from different sources
    let allAgents: PlatformAgent[] = []

    // Handle 'installed' source - get user's installed agents from database
    if (source === 'installed') {
      if (!userId) {
        return []
      }
      const installedAgents = await this.getInstalledAgents(userId)
      return this.enrichResults(installedAgents, userId)
    }

    // Get installed agents from database (for user's installed agents tracking)
    const dbInstalledAgents = await this.getInstalledAgentsFromDb(userId)

    // Handle 'erc8004' source or all sources
    if (source === 'erc8004' || !source) {
      // Fetch from 8004scan API
      try {
        const scanAgents = await this.get8004ScanAgents(filters)
        allAgents = [...scanAgents]
      } catch (error) {
        console.error('Error fetching from 8004scan API:', error)
        // Return empty array if API fails
        allAgents = []
      }
    }

    // Also add user's installed agents to results if not filtering by source or if explicitly requested
    if (!source) {
      const installedPlatformAgents = await this.getInstalledAgents(userId)
      const existingIds = new Set(allAgents.map(a => a.id))
      installedPlatformAgents.forEach(agent => {
        if (!existingIds.has(agent.id)) {
          allAgents.push(agent)
        }
      })
    }

    // Apply in-memory filters that can't be done via API
    let filteredAgents = allAgents.filter(agent => {
      // Capability filter
      if (capability && !this.resolver.matchCapabilities(agent, [capability])) {
        return false
      }

      // Name filter (if not already used for API search)
      if (name && source !== 'erc8004' && !agent.name.toLowerCase().includes(name.toLowerCase())) {
        return false
      }

      // Protocol filter
      if (protocol && !agent.protocols.includes(protocol)) {
        return false
      }

      // Rating filter
      if (minRating && (!agent.reputation || agent.reputation.score < minRating)) {
        return false
      }

      // Tags filter
      if (tags && tags.length > 0) {
        const agentTags = agent.metadata?.tags || []
        if (!tags.some(tag => agentTags.includes(tag))) {
          return false
        }
      }

      return true
    })

    return this.enrichResults(filteredAgents, userId)
  }

  /**
   * Get agents from 8004scan API
   */
  private async get8004ScanAgents(filters: AgentSearchFilters): Promise<PlatformAgent[]> {
    const { capability, name, protocol } = filters
    
    let agents: PlatformAgent[] = []

    // Use searchAgents() for semantic search when name or capability is provided
    if (name || capability) {
      try {
        const searchQuery = name || capability || ''
        const response = await this.scanClient.searchAgents({
          query: searchQuery,
          capabilities: capability ? [capability] : undefined,
          protocols: protocol ? [protocol] : undefined,
          limit: 100,
        })

        if (response.success && response.data) {
          agents = response.data.map(map8004ScanAgentToPlatformAgent)
          console.log(`Found ${agents.length} agents from 8004scan search API`)
        }
      } catch (error) {
        console.error('8004scan searchAgents error:', error)
        throw error
      }
    } else {
      // Use listAgents() for listing with filtering
      try {
        const response = await this.scanClient.listAgents({
          capabilities: capability ? [capability] : undefined,
          protocols: protocol ? [protocol] : undefined,
          limit: 100,
        })

        if (response.success && response.data) {
          agents = response.data.map(map8004ScanAgentToPlatformAgent)
          console.log(`Found ${agents.length} agents from 8004scan list API`)
        }
      } catch (error) {
        console.error('8004scan listAgents error:', error)
        throw error
      }
    }

    return agents
  }

  /**
   * Get installed agents for a user from database
   */
  private async getInstalledAgents(userId?: string): Promise<PlatformAgent[]> {
    if (!userId) {
      return []
    }

    const installedAgents = await prisma.installedAgent.findMany({
      where: { installedBy: userId },
      orderBy: { installedAt: 'desc' },
    })

    return installedAgents.map(agent => ({
      id: agent.agentId,
      name: agent.name,
      description: agent.description || '',
      capabilities: JSON.parse(agent.capabilities || '[]'),
      protocols: [],
      dispatchEndpoint: agent.dispatchEndpoint,
      source: 'installed' as const,
      installedBy: agent.installedBy || 'unknown',
      installedAt: agent.installedAt,
      verified: true,
    }))
  }

  /**
   * Get installed agents from database (without filtering by user)
   */
  private async getInstalledAgentsFromDb(userId?: string): Promise<PlatformAgent[]> {
    const where = userId ? { installedBy: userId } : {}
    
    const installedAgents = await prisma.installedAgent.findMany({
      where,
      orderBy: { installedAt: 'desc' },
    })

    return installedAgents.map(agent => ({
      id: agent.agentId,
      name: agent.name,
      description: agent.description || '',
      capabilities: JSON.parse(agent.capabilities || '[]'),
      protocols: [],
      dispatchEndpoint: agent.dispatchEndpoint,
      source: 'installed' as const,
      installedBy: agent.installedBy || 'unknown',
      installedAt: agent.installedAt,
      verified: true,
    }))
  }



  /**
   * Enrich results with additional data (isInstalled, rating, reviewCount)
   */
  private async enrichResults(
    agents: PlatformAgent[],
    userId?: string
  ): Promise<AgentSearchResult[]> {
    const results: AgentSearchResult[] = []

    for (const agent of agents) {
      const isInstalled = userId ? await this.isAgentInstalled(agent.id, userId) : false

      // Get rating
      const rating = await this.getAgentRating(agent.id)

      results.push({
        agent,
        isInstalled,
        rating: rating?.score || 0,
        reviewCount: rating?.totalRatings || 0,
      })
    }

    return results
  }

  /**
   * Check if agent is installed
   */
  private async isAgentInstalled(agentId: string, userId: string): Promise<boolean> {
    try {
      const installed = await prisma.installedAgent.findUnique({
        where: { agentId },
      })

      return !!installed && installed.installedBy === userId
    } catch (error) {
      return false
    }
  }

  /**
   * Get agent rating
   */
  private async getAgentRating(agentId: string) {
    try {
      const reviews = await prisma.agentReview.findMany({
        where: { agentId },
      })

      if (reviews.length === 0) {
        return null
      }

      const total = reviews.reduce((sum, r) => sum + r.rating, 0)
      const score = total / reviews.length

      return {
        score,
        totalRatings: reviews.length,
        reviews,
      }
    } catch (error) {
      return null
    }
  }
}

/**
 * Create search service instance
 */
export function createAgentSearchService(): AgentSearchService {
  return new AgentSearchService()
}
