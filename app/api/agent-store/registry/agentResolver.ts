/**
 * Agent Resolver
 * Resolves ERC-8004 metadata into normalized PlatformAgent format
 */

import { PlatformAgent, ERC8004AgentCard } from '../types'

/**
 * Agent Resolver Service
 * Converts ERC-8004 Agent Card to Platform Agent format
 */
export class AgentResolver {
  /**
   * Resolve ERC-8004 metadata to Platform Agent format
   */
  resolveAgent(tokenId: number, metadata: ERC8004AgentCard): PlatformAgent {
    const agent = this.normalizeAgent(tokenId, metadata)
    return agent
  }

  /**
   * Resolve multiple agents
   */
  resolveAgents(tokenIds: number[], metadataList: ERC8004AgentCard[]): PlatformAgent[] {
    return metadataList.map((metadata, index) =>
      this.normalizeAgent(tokenIds[index], metadata)
    )
  }

  /**
   * Normalize ERC-8004 metadata to Platform Agent format
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
   * Extract capabilities from various sources
   */
  extractCapabilities(agent: PlatformAgent): string[] {
    const capabilities = new Set<string>()

    // Add from metadata
    if (agent.metadata?.capabilities) {
      agent.metadata.capabilities.forEach(cap => capabilities.add(cap))
    }

    // Add from protocols
    if (agent.metadata?.protocols) {
      agent.metadata.protocols.forEach(proto => {
        // Protocol names often imply capabilities
        capabilities.add(proto.toLowerCase())
      })
    }

    // Add from services
    if (agent.metadata?.services) {
      agent.metadata.services.forEach(service => {
        if (service.name) {
          capabilities.add(service.name.toLowerCase())
        }
      })
    }

    return Array.from(capabilities)
  }

  /**
   * Match agent capabilities against task requirements
   */
  matchCapabilities(agent: PlatformAgent, requiredCapabilities: string[]): boolean {
    const agentCaps = this.extractCapabilities(agent)
    return requiredCapabilities.every(cap => agentCaps.includes(cap))
  }
}

/**
 * Create agent resolver instance
 */
export function createAgentResolver(): AgentResolver {
  return new AgentResolver()
}
