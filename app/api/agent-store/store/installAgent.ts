/**
 * Agent Installation Service
 * Handles agent installation into user's workspace
 */

import { db } from '@/lib/db'
import { PlatformAgent, InstalledAgent } from '../types'
import { AgentResolver } from '../registry/agentResolver'

const prisma = db

/**
 * Agent Installation Service
 */
export class AgentInstallationService {
  private resolver: AgentResolver

  constructor() {
    this.resolver = new AgentResolver()
  }

  /**
   * Install an agent into user's workspace
   */
  async installAgent(agent: PlatformAgent, userId: string): Promise<InstalledAgent> {
    try {
      // Check if already installed
      const existing = await prisma.installedAgent.findUnique({
        where: { agentId: agent.id },
      })

      if (existing) {
        throw new Error('Agent already installed')
      }

      // Convert capabilities to JSON string
      const capabilitiesJson = JSON.stringify(agent.capabilities || [])

      // Create installation record
      const installed = await prisma.installedAgent.create({
        data: {
          agentId: agent.id,
          name: agent.name,
          description: agent.description,
          capabilities: capabilitiesJson,
          dispatchEndpoint: agent.dispatchEndpoint,
          installedBy: userId,
          metadata: agent.metadata ? JSON.stringify(agent.metadata) : null,
        },
      })

      return this.mapToInstalledAgent(installed)
    } catch (error) {
      console.error('Error installing agent:', error)
      throw new Error('Failed to install agent')
    }
  }

  /**
   * Uninstall an agent
   */
  async uninstallAgent(agentId: string, userId: string): Promise<void> {
    try {
      const installed = await prisma.installedAgent.findUnique({
        where: { agentId },
      })

      if (!installed) {
        throw new Error('Agent not installed')
      }

      // Verify ownership
      if (installed.installedBy !== userId) {
        throw new Error('Not authorized to uninstall this agent')
      }

      await prisma.installedAgent.delete({
        where: { agentId },
      })
    } catch (error) {
      console.error('Error uninstalling agent:', error)
      throw new Error('Failed to uninstall agent')
    }
  }

  /**
   * Get all installed agents for a user
   */
  async getInstalledAgents(userId: string): Promise<InstalledAgent[]> {
    try {
      const installed = await prisma.installedAgent.findMany({
        where: { installedBy: userId },
        orderBy: { installedAt: 'desc' },
      })

      return installed.map(this.mapToInstalledAgent)
    } catch (error) {
      console.error('Error getting installed agents:', error)
      throw new Error('Failed to get installed agents')
    }
  }

  /**
   * Check if agent is installed
   */
  async isAgentInstalled(agentId: string, userId: string): Promise<boolean> {
    try {
      const installed = await prisma.installedAgent.findUnique({
        where: { agentId },
      })

      return !!installed && installed.installedBy === userId
    } catch (error) {
      console.error('Error checking agent installation:', error)
      return false
    }
  }

  /**
   * Map database model to InstalledAgent
   */
  private mapToInstalledAgent(model: any): InstalledAgent {
    return {
      id: model.id,
      agentId: model.agentId,
      name: model.name,
      description: model.description,
      capabilities: JSON.parse(model.capabilities || '[]'),
      dispatchEndpoint: model.dispatchEndpoint,
      installedBy: model.installedBy,
      installedAt: model.installedAt,
      metadata: model.metadata ? JSON.parse(model.metadata) : undefined,
    }
  }
}

/**
 * Create installation service instance
 */
export function createAgentInstallationService(): AgentInstallationService {
  return new AgentInstallationService()
}
