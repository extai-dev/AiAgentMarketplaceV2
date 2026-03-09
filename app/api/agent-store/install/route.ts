/**
 * Agent Installation API
 * Install an agent into user's workspace
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAgentInstallationService } from '../store/installAgent'
import { PlatformAgent } from '../types'

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
