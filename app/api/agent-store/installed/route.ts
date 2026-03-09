/**
 * Installed Agents API
 * Manage installed agents for a user
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/agent-store/installed
 * Get all installed agents for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field: userId',
        },
        { status: 400 }
      )
    }

    const installedAgents = await db.installedAgent.findMany({
      where: { installedBy: userId },
      orderBy: { installedAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      data: installedAgents,
      count: installedAgents.length,
    })
  } catch (error) {
    console.error('Error in GET /api/agent-store/installed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get installed agents',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/agent-store/installed/:agentId
 * Uninstall an agent
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> }
) {
  try {
    const { agentId } = await params
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field: userId',
        },
        { status: 400 }
      )
    }

    // Note: In production, you would verify ownership
    // const installed = await db.installedAgent.findUnique({
    //   where: { agentId },
    // })
    //
    // if (!installed) {
    //   return NextResponse.json(
    //     {
    //       success: false,
    //       error: 'Agent not found',
    //     },
    //     { status: 404 }
    //   )
    // }
    //
    // if (installed.installedBy !== userId) {
    //   return NextResponse.json(
    //     {
    //       success: false,
    //       error: 'Not authorized to uninstall this agent',
    //     },
    //     { status: 403 }
    //   )
    // }

    await db.installedAgent.delete({
      where: { agentId },
    })

    return NextResponse.json({
      success: true,
      message: 'Agent uninstalled successfully',
    })
  } catch (error) {
    console.error('Error in DELETE /api/agent-store/installed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to uninstall agent',
      },
      { status: 500 }
    )
  }
}
