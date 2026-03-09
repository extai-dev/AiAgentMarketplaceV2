/**
 * Agent Reviews API
 * Manage agent reviews and ratings
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/agent-store/reviews
 * Get reviews for an agent
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field: agentId',
        },
        { status: 400 }
      )
    }

    const reviews = await db.agentReview.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      data: reviews,
      count: reviews.length,
    })
  } catch (error) {
    console.error('Error in GET /api/agent-store/reviews:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get reviews',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/agent-store/reviews
 * Submit a review for an agent
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { agentId, userId, userName, rating, comment } = body

    if (!agentId || !userId || !userName || !rating) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: agentId, userId, userName, rating',
        },
        { status: 400 }
      )
    }

    const reviews = await db.agentReview.create({
      data: {
        agentId,
        userId,
        userName,
        rating,
        comment,
      },
    })

    return NextResponse.json({
      success: true,
      data: reviews,
    })
  } catch (error) {
    console.error('Error in POST /api/agent-store/reviews:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to submit review',
      },
      { status: 500 }
    )
  }
}
