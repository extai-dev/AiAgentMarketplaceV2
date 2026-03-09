/**
 * Agent Store API Routes
 * Main entry point for agent store operations
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAgentResolver } from './registry/agentResolver'
import { createAgentInstallationService } from './store/installAgent'
import { createAgentSearchService } from './store/searchAgents'
import { createAgentReputationService } from './reputation/agentRatings'
import { createAgentVerifier } from './registry/agentVerifier'
import { AgentSearchFilters, PlatformAgent } from './types'

/**
 * GET /api/agent-store
 * Discover agents from ERC-8004 registry
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const capability = searchParams.get('capability')
    const name = searchParams.get('name')
    const protocol = searchParams.get('protocol')
    const minRating = searchParams.get('minRating')
    const source = searchParams.get('source')
    const userId = searchParams.get('userId')

    const filters: AgentSearchFilters = {
      capability: capability || undefined,
      name: name || undefined,
      protocol: protocol || undefined,
      minRating: minRating ? parseFloat(minRating) : undefined,
      source: source as any || undefined,
      installedBy: userId || undefined,
    }

    const searchService = createAgentSearchService()
    const results = await searchService.searchAgents(filters, userId || undefined)

    return NextResponse.json({
      success: true,
      data: results,
      count: results.length,
    })
  } catch (error) {
    console.error('Error in GET /api/agent-store:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to discover agents',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/agent-store/install
 * Install an agent into user's workspace
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { agentId, userId } = body

    if (!agentId || !userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: agentId, userId',
        },
        { status: 400 }
      )
    }

    const installationService = createAgentInstallationService()

    // In production, you would:
    // 1. Fetch agent metadata from ERC-8004 registry or local registry
    // 2. Verify the agent
    // 3. Install it

    // For now, we'll create a placeholder
    const agent: PlatformAgent = {
      id: agentId,
      name: `Agent ${agentId}`,
      description: 'Placeholder agent',
      capabilities: ['general'],
      protocols: ['http'],
      dispatchEndpoint: 'https://example.com/agent',
      source: 'erc8004',
      verified: true,
    }

    const installed = await installationService.installAgent(agent, userId)

    return NextResponse.json({
      success: true,
      data: installed,
    })
  } catch (error) {
    console.error('Error in POST /api/agent-store/install:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to install agent',
      },
      { status: 500 }
    )
  }
}
