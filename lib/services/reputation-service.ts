/**
 * Reputation Service Module
 * 
 * Handles reputation and feedback:
 * - submitFeedback: Submit feedback for an agent
 * - fetchReputation: Get agent reputation
 * - updateAgentScore: Update agent's reputation score
 * 
 * Integrates with ERC-8004 ReputationRegistry via ChaosChain
 */

import { db } from '@/lib/db';
import { chaosChainService, CHAIN_CONFIG, formatAgentId } from '@/lib/chaoschain-service';

export interface SubmitFeedbackParams {
  agentId: string;
  taskId?: string;
  raterId: string;
  score: number; // 1-5
  tag1?: string;
  tag2?: string;
  comment?: string;
  fileUri?: string;
  fileHash?: string;
  txHash?: string;
}

/**
 * Submit feedback for an agent
 */
export async function submitFeedback(params: SubmitFeedbackParams): Promise<{
  success: boolean;
  feedback?: any;
  error?: string;
}> {
  try {
    // Validate score
    if (params.score < 1 || params.score > 5) {
      return { success: false, error: 'Score must be between 1 and 5' };
    }

    // Verify agent exists
    const agent = await db.agent.findUnique({
      where: { id: params.agentId },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // Check for existing feedback from same rater for same task
    if (params.taskId) {
      const existing = await db.reputationRecord.findFirst({
        where: {
          agentId: params.agentId,
          taskId: params.taskId,
          raterId: params.raterId,
        },
      });

      if (existing) {
        return { success: false, error: 'Feedback already submitted for this task' };
      }
    }

    // Submit to ChaosChain if agent has ERC-8004 ID
    let txHash = params.txHash;
    if (agent.erc8004AgentId) {
      try {
        const result = await chaosChainService.submitFeedback({
          agentId: agent.erc8004AgentId,
          rating: params.score,
          comment: params.comment,
          proofOfPayment: {
            transactionHash: params.txHash || '0x0000000000000000000000000000000000000000',
            amount: BigInt(0),
          },
        });

        if (result.success && result.transactionHash) {
          txHash = result.transactionHash;
        }
      } catch (error) {
        console.error('Error submitting to ChaosChain:', error);
      }
    }

    // Create reputation record
    const feedback = await db.reputationRecord.create({
      data: {
        agentId: params.agentId,
        taskId: params.taskId,
        raterId: params.raterId,
        score: params.score,
        tag1: params.tag1,
        tag2: params.tag2,
        comment: params.comment,
        fileUri: params.fileUri,
        fileHash: params.fileHash,
        txHash,
      },
    });

    // Update agent's cached reputation
    await updateAgentScore(params.agentId);

    return { success: true, feedback };
  } catch (error) {
    console.error('Error submitting feedback:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to submit feedback' };
  }
}

/**
 * Get agent reputation
 */
export async function fetchReputation(agentId: string): Promise<{
  success: boolean;
  reputation?: {
    totalRatings: number;
    averageScore: number;
    scoreBreakdown: {
      reasoning: number;
      efficiency: number;
      compliance: number;
      collaboration: number;
    };
    recentFeedback: Array<{
      id: string;
      score: number;
      tag1?: string;
      tag2?: string;
      comment?: string;
      createdAt: Date;
    }>;
    onChain?: {
      totalRatings: number;
      averageRating: number;
    };
  };
  error?: string;
}> {
  try {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // Get all feedback for this agent
    const feedbacks = await db.reputationRecord.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const totalRatings = feedbacks.length;
    const averageScore = totalRatings > 0
      ? feedbacks.reduce((sum, f) => sum + f.score, 0) / totalRatings
      : 0;

    // Calculate score breakdown by tag
    const tagScores: Record<string, { total: number; count: number }> = {};
    
    for (const feedback of feedbacks) {
      if (feedback.tag1) {
        if (!tagScores[feedback.tag1]) {
          tagScores[feedback.tag1] = { total: 0, count: 0 };
        }
        tagScores[feedback.tag1].total += feedback.score;
        tagScores[feedback.tag1].count++;
      }
      if (feedback.tag2) {
        if (!tagScores[feedback.tag2]) {
          tagScores[feedback.tag2] = { total: 0, count: 0 };
        }
        tagScores[feedback.tag2].total += feedback.score;
        tagScores[feedback.tag2].count++;
      }
    }

    const scoreBreakdown = {
      reasoning: tagScores['reasoning'] 
        ? Math.round((tagScores['reasoning'].total / tagScores['reasoning'].count) * 20) 
        : 0,
      efficiency: tagScores['efficiency'] 
        ? Math.round((tagScores['efficiency'].total / tagScores['efficiency'].count) * 20) 
        : 0,
      compliance: tagScores['compliance'] 
        ? Math.round((tagScores['compliance'].total / tagScores['compliance'].count) * 20) 
        : 0,
      collaboration: tagScores['collaboration'] 
        ? Math.round((tagScores['collaboration'].total / tagScores['collaboration'].count) * 20) 
        : 0,
    };

    // Get recent feedback
    const recentFeedback = feedbacks.slice(0, 10).map(f => ({
      id: f.id,
      score: f.score,
      tag1: f.tag1,
      tag2: f.tag2,
      comment: f.comment,
      createdAt: f.createdAt,
    }));

    // Try to get on-chain reputation
    let onChain;
    if (agent.erc8004AgentId) {
      try {
        const chainRep = await chaosChainService.getReputation(agent.erc8004AgentId);
        if (chainRep) {
          onChain = {
            totalRatings: chainRep.totalRatings,
            averageRating: chainRep.averageRating,
          };
        }
      } catch (error) {
        console.error('Error fetching on-chain reputation:', error);
      }
    }

    return {
      success: true,
      reputation: {
        totalRatings,
        averageScore: Math.round(averageScore * 10) / 10,
        scoreBreakdown,
        recentFeedback,
        onChain,
      },
    };
  } catch (error) {
    console.error('Error fetching reputation:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch reputation' };
  }
}

/**
 * Update agent's cached reputation score
 */
export async function updateAgentScore(agentId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const feedbacks = await db.reputationRecord.findMany({
      where: { agentId },
    });

    if (feedbacks.length === 0) {
      return { success: true };
    }

    const totalScore = feedbacks.reduce((sum, f) => sum + f.score, 0);
    const averageScore = totalScore / feedbacks.length;

    // Calculate weighted score (recent performance weighted more)
    const recentFeedbacks = feedbacks.slice(0, 20);
    const recentScore = recentFeedbacks.length > 0
      ? recentFeedbacks.reduce((sum, f) => sum + f.score, 0) / recentFeedbacks.length
      : averageScore;

    // Combined score: 60% recent, 40% all-time
    const combinedScore = (recentScore * 0.6) + (averageScore * 0.4);

    await db.agent.update({
      where: { id: agentId },
      data: {
        reputationScore: Math.round(combinedScore * 10) / 10,
        averageRating: Math.round(averageScore * 10) / 10,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating agent score:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update score' };
  }
}

/**
 * Get all feedback for an agent
 */
export async function getAgentFeedback(agentId: string, limit?: number): Promise<{
  success: boolean;
  feedback?: any[];
  error?: string;
}> {
  try {
    const feedbacks = await db.reputationRecord.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: limit || 20,
    });

    return { success: true, feedback: feedbacks };
  } catch (error) {
    console.error('Error fetching feedback:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch feedback' };
  }
}

/**
 * Get feedback by task
 */
export async function getFeedbackByTask(taskId: string): Promise<{
  success: boolean;
  feedback?: any[];
  error?: string;
}> {
  try {
    const feedbacks = await db.reputationRecord.findMany({
      where: { taskId },
    });

    return { success: true, feedback: feedbacks };
  } catch (error) {
    console.error('Error fetching feedback:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch feedback' };
  }
}

/**
 * Calculate weighted reputation score
 * Combines: success_rate, average_score, task_volume, recent_performance
 */
export async function calculateWeightedReputation(agentId: string): Promise<{
  success: boolean;
  weightedScore?: number;
  breakdown?: {
    successRate: number;
    averageScore: number;
    volumeScore: number;
    recentPerformance: number;
  };
  error?: string;
}> {
  try {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // Success rate
    const successRate = agent.totalTasks > 0
      ? (agent.completedTasks / agent.totalTasks) * 100
      : 0;

    // Average score (already calculated)
    const averageScore = agent.averageRating * 20; // Convert 1-5 to 0-100

    // Volume score (max 100 at 100 tasks)
    const volumeScore = Math.min(100, agent.totalTasks);

    // Recent performance (get last 10 feedbacks)
    const recentFeedbacks = await db.reputationRecord.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const recentPerformance = recentFeedbacks.length > 0
      ? (recentFeedbacks.reduce((sum, f) => sum + f.score, 0) / recentFeedbacks.length) * 20
      : averageScore;

    // Weighted calculation: 30% success rate, 25% average, 15% volume, 30% recent
    const weightedScore = Math.round(
      successRate * 0.30 +
      averageScore * 0.25 +
      volumeScore * 0.15 +
      recentPerformance * 0.30
    );

    return {
      success: true,
      weightedScore,
      breakdown: {
        successRate: Math.round(successRate),
        averageScore: Math.round(averageScore),
        volumeScore: Math.round(volumeScore),
        recentPerformance: Math.round(recentPerformance),
      },
    };
  } catch (error) {
    console.error('Error calculating weighted reputation:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to calculate' };
  }
}
