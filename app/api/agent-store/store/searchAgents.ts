/**
 * Agent Search Service
 * Search and filter agents based on various criteria
 */

import { db } from '@/lib/db'
import { PlatformAgent, InstalledAgent, AgentSearchFilters, AgentSearchResult } from '../types'
import { AgentResolver } from '../registry/agentResolver'
import { indexAgents } from '../registry/crossChainIndexer'

const prisma = db

/**
 * Agent Search Service
 */
export class AgentSearchService {
  private resolver: AgentResolver

  constructor() {
    this.resolver = new AgentResolver()
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

    // Build query conditions
    const where: any = {}

    // Filter by source (local, ERC-8004, or installed)
    if (source) {
      if (source === 'installed') {
        if (!userId) {
          // No userId provided, return empty results for installed
          return []
        }
        where.id = { in: await this.getInstalledAgentIds(userId) }
      } else if (source === 'erc8004') {
        where.id = { startsWith: 'erc8004:' }
      } else if (source === 'local') {
        where.id = { startsWith: 'local:' }
      }
    }

    // Filter by capability
    if (capability) {
      where.capabilities = { contains: capability }
    }

    // Filter by name
    if (name) {
      where.name = { contains: name, mode: 'insensitive' }
    }

    // Filter by installedBy
    if (installedBy) {
      where.installedBy = installedBy
    }

    // Get agents from database
    // If no userId, get all installed agents (for discovery)
    const installedAgents = await prisma.installedAgent.findMany({
      where: userId ? { installedBy: userId } : {},
      orderBy: { installedAt: 'desc' },
    })

    // Convert to PlatformAgent format
    const platformAgents: PlatformAgent[] = installedAgents.map(agent => ({
      id: agent.agentId,
      name: agent.name,
      description: agent.description || '',
      capabilities: JSON.parse(agent.capabilities || '[]'),
      protocols: [],
      dispatchEndpoint: agent.dispatchEndpoint,
      source: 'installed',
      installedBy: agent.installedBy,
      installedAt: agent.installedAt,
      verified: true, // Installed agents are considered verified
    }))

    // If searching for installed agents only, return results
    if (source === 'installed') {
      return this.enrichResults(platformAgents, userId)
    }

    // For all other sources, we need to fetch agents from other sources
    // This is a simplified implementation - in production, you'd integrate
    // with local agents and ERC-8004 discovery
    const allAgents = await this.getAllAgents(userId)

    // Apply filters
    let filteredAgents = allAgents.filter(agent => {
      // Source filter
      if (source && agent.source !== source) {
        return false
      }

      // Capability filter
      if (capability && !this.resolver.matchCapabilities(agent, [capability])) {
        return false
      }

      // Name filter
      if (name && !agent.name.toLowerCase().includes(name.toLowerCase())) {
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

      return true
    })

    return this.enrichResults(filteredAgents, userId)
  }

  /**
   * Get all available agents (local + ERC-8004 from indexer)
   */
  private async getAllAgents(userId?: string): Promise<PlatformAgent[]> {
    const agents: PlatformAgent[] = []

    // Add installed agents (if userId provided, otherwise get all)
    const installedAgents = await prisma.installedAgent.findMany({
      where: userId ? { installedBy: userId } : {},
    })

    installedAgents.forEach(agent => {
      agents.push({
        id: agent.agentId,
        name: agent.name,
        description: agent.description || '',
        capabilities: JSON.parse(agent.capabilities || '[]'),
        protocols: [],
        dispatchEndpoint: agent.dispatchEndpoint,
        source: 'installed',
        installedBy: agent.installedBy,
        installedAt: agent.installedAt,
        verified: true, // Installed agents are considered verified
      })
    })

    // Fetch ERC-8004 agents from cross-chain indexer
    try {
      console.log('Fetching ERC-8004 agents from cross-chain indexer...')
      
      // Run the cross-chain indexing pipeline
      const indexedAgents = await indexAgents()
      
      // Query indexed agents from database (all agents, not just user's)
      const storedAgents = await prisma.installedAgent.findMany({
        where: {
          agentId: { startsWith: 'eip155:' },
        },
      })

      // Add any stored agents that aren't already in the list
      const existingIds = new Set(agents.map(a => a.id))
      storedAgents.forEach(agent => {
        if (!existingIds.has(agent.agentId)) {
          agents.push({
            id: agent.agentId,
            name: agent.name,
            description: agent.description || '',
            capabilities: JSON.parse(agent.capabilities || '[]'),
            protocols: [],
            dispatchEndpoint: agent.dispatchEndpoint,
            source: 'erc8004',
            installedBy: agent.installedBy,
            installedAt: agent.installedAt,
            verified: true,
          })
        }
      })

      console.log(`Found ${storedAgents.length} ERC-8004 agents from cross-chain indexer`)
    } catch (error) {
      console.error('Error fetching from cross-chain indexer:', error)
      
      // Fallback: Try to get existing indexed agents from database even if indexing fails
      console.log('Attempting fallback: retrieving existing indexed agents from database...')
      try {
        const existingIndexedAgents = await prisma.installedAgent.findMany({
          where: {
            agentId: { startsWith: 'eip155:' },
          },
        })
        
        const existingIds = new Set(agents.map(a => a.id))
        existingIndexedAgents.forEach(agent => {
          if (!existingIds.has(agent.agentId)) {
            agents.push({
              id: agent.agentId,
              name: agent.name,
              description: agent.description || '',
              capabilities: JSON.parse(agent.capabilities || '[]'),
              protocols: [],
              dispatchEndpoint: agent.dispatchEndpoint,
              source: 'erc8004',
              installedBy: agent.installedBy,
              installedAt: agent.installedAt,
              verified: true,
            })
          }
        })
        
        console.log(`Found ${existingIndexedAgents.length} existing indexed agents from fallback`)
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError)
      }
    }

    // If still no agents found, add demo agents as fallback
    if (agents.length === 0) {
      console.log('No agents found from blockchain or database. Adding demo agents...')
      const demoAgents = this.getDemoAgents()
      agents.push(...demoAgents)
    }

    return agents
  }

  /**
   * Get demo agents for development/testing
   */
  private getDemoAgents(): PlatformAgent[] {
    return [
      {
        id: 'demo:research-agent',
        name: 'Research Agent',
        description: 'AI agent specialized in blockchain research and analysis',
        capabilities: ['research', 'analysis', 'data-collection'],
        protocols: ['http', 'a2a'],
        dispatchEndpoint: 'https://research-agent.example.com/api',
        source: 'local',
        verified: true,
      },
      {
        id: 'demo:trading-agent',
        name: 'Trading Agent',
        description: 'Automated trading agent with DeFi integration',
        capabilities: ['trading', 'defi', 'arbitrage'],
        protocols: ['http', 'a2a'],
        dispatchEndpoint: 'https://trading-agent.example.com/api',
        source: 'local',
        verified: true,
      },
      {
        id: 'demo:analytics-agent',
        name: 'Analytics Agent',
        description: 'Real-time analytics and monitoring agent',
        capabilities: ['analytics', 'monitoring', 'reporting'],
        protocols: ['http', 'a2a'],
        dispatchEndpoint: 'https://analytics-agent.example.com/api',
        source: 'local',
        verified: true,
      },
      {
        id: 'demo:assistant-agent',
        name: 'Assistant Agent',
        description: 'General purpose AI assistant for task automation',
        capabilities: ['assistant', 'task-automation', 'communication'],
        protocols: ['http', 'a2a'],
        dispatchEndpoint: 'https://assistant-agent.example.com/api',
        source: 'local',
        verified: true,
      },
    ]
  }

  /**
   * Get installed agent IDs for user
   */
  private async getInstalledAgentIds(userId: string): Promise<string[]> {
    const installed = await prisma.installedAgent.findMany({
      where: { installedBy: userId },
      select: { agentId: true },
    })

    return installed.map(a => a.agentId)
  }

  /**
   * Enrich results with additional data
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
