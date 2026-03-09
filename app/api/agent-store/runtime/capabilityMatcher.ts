/**
 * Capability Matcher
 * Matches tasks to agents based on capabilities
 */

import { PlatformAgent, AgentTask } from '../types'
import { AgentResolver } from '../registry/agentResolver'

/**
 * Capability Matcher
 */
export class CapabilityMatcher {
  private resolver: AgentResolver

  constructor() {
    this.resolver = new AgentResolver()
  }

  /**
   * Match agents that can handle a task
   */
  matchAgents(task: AgentTask, agents: PlatformAgent[]): PlatformAgent[] {
    return agents.filter(agent =>
      this.resolver.matchCapabilities(agent, [task.type])
    )
  }

  /**
   * Find best matching agent for a task
   */
  findBestAgent(task: AgentTask, agents: PlatformAgent[]): PlatformAgent | null {
    const matchingAgents = this.matchAgents(task, agents)

    if (matchingAgents.length === 0) {
      return null
    }

    // Simple strategy: return first matching agent
    // In production, you could implement more sophisticated strategies
    // like reputation scoring, cost optimization, etc.
    return matchingAgents[0]
  }

  /**
   * Get all capabilities from agents
   */
  getAllCapabilities(agents: PlatformAgent[]): string[] {
    const capabilities = new Set<string>()

    agents.forEach(agent => {
      const agentCaps = this.resolver.extractCapabilities(agent)
      agentCaps.forEach(cap => capabilities.add(cap))
    })

    return Array.from(capabilities)
  }

  /**
   * Get capabilities distribution
   */
  getCapabilitiesDistribution(agents: PlatformAgent[]): Record<string, number> {
    const distribution: Record<string, number> = {}

    agents.forEach(agent => {
      const agentCaps = this.resolver.extractCapabilities(agent)
      agentCaps.forEach(cap => {
        distribution[cap] = (distribution[cap] || 0) + 1
      })
    })

    return distribution
  }
}

/**
 * Create capability matcher instance
 */
export function createCapabilityMatcher(): CapabilityMatcher {
  return new CapabilityMatcher()
}
