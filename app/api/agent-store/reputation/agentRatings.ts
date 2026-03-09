/**
 * Agent Reputation Service
 * Handles agent ratings and reviews
 */

import { db } from '@/lib/db'
import { AgentReview } from '../types'

const prisma = db

/**
 * Agent Reputation Service
 */
export class AgentReputationService {
  /**
   * Submit a review for an agent
   */
  async submitReview(
    agentId: string,
    userId: string,
    userName: string,
    rating: number,
    comment?: string
  ): Promise<AgentReview> {
    try {
      // Validate rating
      if (rating < 1 || rating > 5) {
        throw new Error('Rating must be between 1 and 5')
      }

      // Check if user already reviewed
      const existing = await prisma.agentReview.findUnique({
        where: {
          agentId_userId: {
            agentId,
            userId,
          },
        },
      })

      if (existing) {
        throw new Error('You have already reviewed this agent')
      }

      // Create review
      const review = await prisma.agentReview.create({
        data: {
          agentId,
          userId,
          userName,
          rating,
          comment,
        },
      })

      return this.mapToReview(review)
    } catch (error) {
      console.error('Error submitting review:', error)
      throw new Error('Failed to submit review')
    }
  }

  /**
   * Get reviews for an agent
   */
  async getReviews(agentId: string): Promise<AgentReview[]> {
    try {
      const reviews = await prisma.agentReview.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
      })

      return reviews.map(this.mapToReview)
    } catch (error) {
      console.error('Error getting reviews:', error)
      throw new Error('Failed to get reviews')
    }
  }

  /**
   * Get agent rating statistics
   */
  async getRatingStats(agentId: string) {
    try {
      const reviews = await prisma.agentReview.findMany({
        where: { agentId },
      })

      if (reviews.length === 0) {
        return {
          score: 0,
          totalRatings: 0,
          averageRating: 0,
          distribution: {},
        }
      }

      const total = reviews.reduce((sum, r) => sum + r.rating, 0)
      const score = total / reviews.length

      // Calculate distribution
      const distribution: Record<number, number> = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      }

      reviews.forEach(r => {
        distribution[r.rating]++
      })

      return {
        score,
        totalRatings: reviews.length,
        averageRating: score,
        distribution,
      }
    } catch (error) {
      console.error('Error getting rating stats:', error)
      throw new Error('Failed to get rating stats')
    }
  }

  /**
   * Get user's review for an agent
   */
  async getUserReview(agentId: string, userId: string): Promise<AgentReview | null> {
    try {
      const review = await prisma.agentReview.findUnique({
        where: {
          agentId_userId: {
            agentId,
            userId,
          },
        },
      })

      return review ? this.mapToReview(review) : null
    } catch (error) {
      console.error('Error getting user review:', error)
      return null
    }
  }

  /**
   * Delete a review
   */
  async deleteReview(reviewId: string, userId: string): Promise<void> {
    try {
      const review = await prisma.agentReview.findUnique({
        where: { id: reviewId },
      })

      if (!review) {
        throw new Error('Review not found')
      }

      if (review.userId !== userId) {
        throw new Error('Not authorized to delete this review')
      }

      await prisma.agentReview.delete({
        where: { id: reviewId },
      })
    } catch (error) {
      console.error('Error deleting review:', error)
      throw new Error('Failed to delete review')
    }
  }

  /**
   * Map database model to AgentReview
   */
  private mapToReview(model: any): AgentReview {
    return {
      id: model.id,
      agentId: model.agentId,
      userId: model.userId,
      userName: model.userName,
      rating: model.rating,
      comment: model.comment,
      createdAt: model.createdAt,
    }
  }
}

/**
 * Create reputation service instance
 */
export function createAgentReputationService(): AgentReputationService {
  return new AgentReputationService()
}
