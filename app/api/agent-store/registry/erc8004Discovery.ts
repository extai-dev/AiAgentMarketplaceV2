/**
 * ERC-8004 Discovery Layer
 * Discovers agents from ERC-8004 identity registry with caching
 */

import { ethers } from 'ethers'
import { PlatformAgent, ERC8004AgentCard } from '../types'
import { cacheService } from './cacheService'

/**
 * ERC-8004 Registry ABI
 * Note: ERC-8004 uses event-based discovery, not totalSupply()
 */
const ERC8004_REGISTRY_ABI = [
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function isApprovedForAll(address owner, address operator) external view returns (bool)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
]

/**
 * ERC-8004 Discovery Service
 * Discovers agents from the ERC-8004 identity registry
 */
export class ERC8004Discovery {
  private registry: ethers.Contract
  private cacheKey = 'erc8004:discovered_agents'
  private cacheTTL = 5 * 60 * 1000 // 5 minutes

  constructor(registryAddress: string, provider: ethers.Provider) {
    this.registry = new ethers.Contract(registryAddress, ERC8004_REGISTRY_ABI, provider)
  }

  /**
   * Discover all agents from the registry using event-based indexing
   * Uses caching to avoid repeated RPC calls
   */
  async discoverAgents(): Promise<PlatformAgent[]> {
    const cached = await cacheService.get<PlatformAgent[]>(this.cacheKey)
    if (cached) {
      return cached
    }

    try {
      // Query for Registered events from recent blocks (last 10000 blocks)
      // This avoids timeout issues with querying from block 0
      const currentBlock = await this.registry.runner?.provider?.getBlockNumber() || 0
      const fromBlock = Math.max(0, currentBlock - 10000)
      
      const filter = this.registry.filters.Registered()
      const events = await this.registry.queryFilter(filter, fromBlock, 'latest')
      
      const agents: PlatformAgent[] = []

      // Process each Registered event
      for (const event of events) {
        try {
          // Decode the event log to get the parameters
          const decoded = this.registry.interface.parseLog({
            topics: event.topics,
            data: event.data,
          })
          
          if (!decoded) {
            console.error('Failed to decode event:', event)
            continue
          }

          // Extract agentId and agentURI from decoded event args
          const agentId = Number(decoded.args.agentId)
          const agentURI = decoded.args.agentURI
          
          if (!agentId || !agentURI) {
            console.error('Invalid event args:', decoded.args)
            continue
          }

          // Fetch and parse agent metadata
          const metadata = await this.fetchMetadata(agentURI)
          if (!metadata) {
            console.error(`Failed to fetch metadata for agent ${agentId}`)
            continue
          }

          // Normalize agent data
          const agent = this.normalizeAgent(agentId, metadata)
          if (agent) {
            agents.push(agent)
          }
        } catch (error) {
          console.error(`Failed to process agent from event:`, error, event)
          continue
        }
      }

      // Cache the results
      await cacheService.set(this.cacheKey, agents, this.cacheTTL)

      return agents
    } catch (error) {
      console.error('Error discovering agents:', error)
      // Return empty array instead of throwing to allow the app to continue working
      return []
    }
  }

  /**
   * Discover a single agent by token ID
   */
  async discoverAgent(tokenId: number): Promise<PlatformAgent | null> {
    try {
      const uri = await this.registry.tokenURI(BigInt(tokenId))
      const metadata = await this.fetchMetadata(uri)

      if (!metadata) {
        return null
      }

      return this.normalizeAgent(tokenId, metadata)
    } catch (error) {
      console.error(`Error discovering agent ${tokenId}:`, error)
      return null
    }
  }

  /**
   * Fetch agent metadata from URI
   */
  private async fetchMetadata(uri: string): Promise<ERC8004AgentCard | null> {
    try {
      // Handle IPFS URIs
      let fetchUrl = uri
      if (uri.startsWith('ipfs://')) {
        fetchUrl = `https://ipfs.io/ipfs/${uri.replace('ipfs://', '')}`
      } else if (uri.startsWith('data:application/json;base64,')) {
        const base64Data = uri.split(',')[1]
        const json = Buffer.from(base64Data, 'base64').toString('utf-8')
        return JSON.parse(json)
      }

      const response = await fetch(fetchUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Error fetching metadata:', error)
      return null
    }
  }

  /**
   * Normalize ERC-8004 metadata to PlatformAgent format
   */
  private normalizeAgent(tokenId: number, metadata: ERC8004AgentCard): PlatformAgent {
    // Handle both 'services' and 'endpoints' fields
    const services = metadata.services || metadata.endpoints || []
    const primaryEndpoint = services[0]?.endpoint || ''

    return {
      id: `erc8004:${tokenId}`,
      name: metadata.name || 'Unknown Agent',
      description: metadata.description || '',
      capabilities: metadata.capabilities || [],
      protocols: metadata.protocols || [],
      dispatchEndpoint: primaryEndpoint,
      source: 'erc8004',
      verified: this.verifyMetadata(metadata),
      metadata,
    }
  }

  /**
   * Verify agent metadata
   */
  private verifyMetadata(metadata: ERC8004AgentCard): boolean {
    // Basic validation
    if (!metadata.name) {
      return false
    }

    if (!metadata.description) {
      return false
    }

    // Validate endpoint
    if (!metadata.services && !metadata.endpoints) {
      return false
    }

    const services = metadata.services || metadata.endpoints || []
    if (services.length === 0) {
      return false
    }

    const primaryEndpoint = services[0]?.endpoint
    if (!primaryEndpoint) {
      return false
    }

    // Validate endpoint format
    try {
      new URL(primaryEndpoint)
    } catch {
      return false
    }

    return true
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    await cacheService.delete(this.cacheKey)
  }

  /**
   * Get cached agents without fetching
   */
  async getCachedAgents(): Promise<PlatformAgent[] | null> {
    return await cacheService.get(this.cacheKey)
  }
}

/**
 * Create ERC-8004 discovery instance
 */
export function createERC8004Discovery(
  registryAddress: string,
  provider: ethers.Provider
): ERC8004Discovery {
  return new ERC8004Discovery(registryAddress, provider)
}
