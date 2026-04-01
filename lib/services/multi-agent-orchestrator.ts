/**
 * Multi-Agent Orchestrator Service
 * 
 * Central controller for the competitive refinement system.
 * Manages parallel execution, evaluation cycles, and final selection.
 */

import { db } from '@/lib/db';
import { ExecutionStatus, ParticipationStatus, EvaluationStatus, SelectionMode } from '@prisma/client';
import { evaluateSubmissions } from './judge-service';
import { dispatchMultiAgentRound } from '@/lib/agent-dispatcher';
import { decryptApiToken } from '@/lib/agent-crypto';

interface StartMultiAgentParams {
  taskId: string;
  agentIds: string[];
  maxRounds?: number;
  minScoreThreshold?: number;
  selectionMode?: SelectionMode;
  judgeModel?: string;
  judgeProvider?: string;
}

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_MIN_SCORE = 70;
const DEFAULT_SELECTION_MODE = SelectionMode.WINNER_TAKE_ALL;

export async function startMultiAgentExecution(params: StartMultiAgentParams): Promise<{
  success: boolean;
  executionId?: string;
  error?: string;
}> {
  const {
    taskId,
    agentIds,
    maxRounds = DEFAULT_MAX_ROUNDS,
    minScoreThreshold = DEFAULT_MIN_SCORE,
    selectionMode = DEFAULT_SELECTION_MODE,
    judgeModel = 'gemini-2.0-flash',
    judgeProvider = 'gemini',
  } = params;

  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: { taskExecution: true },
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.status !== 'OPEN' && task.status !== 'IN_PROGRESS') {
      return { success: false, error: `Task is not in correct state: ${task.status}` };
    }

    if (!task.multiAgentEnabled) {
      return { success: false, error: 'Multi-agent mode is not enabled for this task' };
    }

    if (agentIds.length < task.minAgentsRequired) {
      return { success: false, error: `Need at least ${task.minAgentsRequired} agents, got ${agentIds.length}` };
    }

    if (agentIds.length > task.maxAgentsAllowed) {
      return { success: false, error: `Max ${task.maxAgentsAllowed} agents allowed, got ${agentIds.length}` };
    }

    if (!task.escrowDeposited) {
      return { success: false, error: 'Escrow must be deposited before starting multi-agent execution' };
    }

    const execution = await db.taskExecution.create({
      data: {
        taskId,
        status: ExecutionStatus.AGENTS_GENERATING,
        currentRound: 1,
        maxRounds,
        minScoreThreshold,
        selectionMode,
        judgeModel,
        judgeProvider,
        startedAt: new Date(),
      },
    });

    await db.agentParticipation.createMany({
      data: agentIds.map((agentId) => ({
        taskExecutionId: execution.id,
        agentId,
        status: ParticipationStatus.INVITED,
        currentRound: 1,
      })),
    });

    await db.task.update({
      where: { id: taskId },
      data: { status: 'IN_PROGRESS' },
    });

    await notifyAgentsToGenerate(execution.id, task, 1);

    return { success: true, executionId: execution.id };
  } catch (error) {
    console.error('[Orchestrator] Failed to start multi-agent execution:', error);
    return { success: false, error: 'Failed to start execution' };
  }
}

async function getAgentApiToken(agentId: string): Promise<string | null> {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent?.apiTokenEncrypted) return null;
  return decryptApiToken(agent.apiTokenEncrypted);
}

async function notifyAgentsToGenerate(
  executionId: string,
  task: any,
  round: number
): Promise<void> {
  const participations = await db.agentParticipation.findMany({
    where: { taskExecutionId: executionId },
    include: { agent: true },
  });

  for (const participation of participations) {
    if (participation.status === ParticipationStatus.ELIMINATED) continue;

    await db.agentParticipation.update({
      where: { id: participation.id },
      data: {
        status: ParticipationStatus.GENERATING,
        currentRound: round,
        lastActiveAt: new Date(),
      },
    });

    try {
      const apiToken = await getAgentApiToken(participation.agentId);
      if (!apiToken) {
        console.error(`[Orchestrator] No API token for agent ${participation.agentId}`);
        continue;
      }

      const result = await dispatchMultiAgentRound(
        participation.agent,
        task,
        executionId,
        round,
        apiToken,
      );

      if (!result.success) {
        console.error(`[Orchestrator] Failed to dispatch to agent ${participation.agentId}: ${result.error}`);
      }
    } catch (error) {
      console.error(`[Orchestrator] Failed to notify agent ${participation.agentId}:`, error);
    }
  }
}

export async function submitMultiAgentSubmission(params: {
  executionId: string;
  agentId: string;
  content: string;
}): Promise<{ success: boolean; submissionId?: string; error?: string }> {
  try {
    const execution = await db.taskExecution.findUnique({
      where: { id: params.executionId },
      include: {
        task: true,
        participations: { where: { agentId: params.agentId } },
      },
    });

    if (!execution) {
      return { success: false, error: 'Execution not found' };
    }

    if (execution.status !== ExecutionStatus.AGENTS_GENERATING && 
        execution.status !== ExecutionStatus.REVISING) {
      return { success: false, error: `Cannot submit in status: ${execution.status}` };
    }

    const participation = execution.participations[0];
    if (!participation) {
      return { success: false, error: 'Agent not part of this execution' };
    }

    if (participation.status === ParticipationStatus.ELIMINATED) {
      return { success: false, error: 'Agent has been eliminated from competition' };
    }

    const submission = await db.submission.create({
      data: {
        taskId: execution.taskId,
        agentId: params.agentId,
        version: participation.currentRound,
        content: params.content,
        taskExecutionId: execution.id,
        status: 'SUBMITTED',
      },
    });

    await db.agentParticipation.update({
      where: { id: participation.id },
      data: {
        status: ParticipationStatus.WAITING_EVAL,
        totalSubmissions: { increment: 1 },
        lastActiveAt: new Date(),
      },
    });

    await checkRoundCompletion(execution.id);

    return { success: true, submissionId: submission.id };
  } catch (error) {
    console.error('[Orchestrator] Failed to submit:', error);
    return { success: false, error: 'Failed to submit' };
  }
}

async function checkRoundCompletion(executionId: string): Promise<void> {
  const execution = await db.taskExecution.findUnique({
    where: { id: executionId },
    include: { participations: true },
  });

  if (!execution) return;

  const pendingAgents = execution.participations.filter(
    (p) => p.status === ParticipationStatus.GENERATING
  );

  if (pendingAgents.length > 0) {
    console.log(`[Orchestrator] Waiting for ${pendingAgents.length} agents to submit`);
    return;
  }

  console.log(`[Orchestrator] All agents submitted for round ${execution.currentRound}, triggering evaluation`);
  await runEvaluationPhase(executionId);
}

async function runEvaluationPhase(executionId: string): Promise<void> {
  // Note: must NOT filter submissions by execution.currentRound inside findUnique —
  // execution is not assigned yet at that point (temporal dead zone).
  const execution = await db.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: true,
      submissions: {
        include: { agent: true },
      },
      participations: true,
    },
  });

  if (!execution) return;

  await db.taskExecution.update({
    where: { id: executionId },
    data: { status: ExecutionStatus.EVALUATING },
  });

  // Filter submissions for the current round after execution is loaded
  const submissions = execution.submissions
    .filter((s) => s.version === execution.currentRound)
    .map((s) => ({
      submissionId: s.id,
      agentId: s.agentId,
      agentName: s.agent.name,
      content: s.content,
      version: s.version,
    }));

  if (submissions.length === 0) {
    console.error('[Orchestrator] No submissions to evaluate');
    await failExecution(executionId, 'No submissions to evaluate');
    return;
  }

  const evaluationResult = await evaluateSubmissions({
    taskTitle: execution.task.title,
    taskDescription: execution.task.description,
    submissions,
    round: execution.currentRound,
    maxRound: execution.maxRounds,
    judgeModel: execution.judgeModel,
    judgeProvider: execution.judgeProvider,
  });

  if (!evaluationResult.success) {
    console.error('[Orchestrator] Judge evaluation failed:', evaluationResult.error);
    await failExecution(executionId, evaluationResult.error || 'Judge evaluation failed');
    return;
  }

  const evaluations = evaluationResult.evaluations || [];
  const bestAgentId = evaluationResult.winnerAgentId;

  for (const evalResult of evaluations) {
    const submission = execution.submissions.find((s) => s.agentId === evalResult.agentId);
    if (!submission) continue;

    await db.evaluation.create({
      data: {
        taskExecutionId: executionId,
        round: execution.currentRound,
        submissionId: submission.id,
        agentId: evalResult.agentId,
        status: EvaluationStatus.COMPLETED,
        overallScore: evalResult.overallScore,
        dimensionsJson: JSON.stringify(evalResult.dimensions || {}),
        feedback: evalResult.feedback,
        isBestInRound: evalResult.agentId === bestAgentId,
        shouldContinue: evalResult.shouldContinue ?? true,
        tokensUsed: evalResult.tokensUsed,
        costUsd: evalResult.costUsd,
        evaluatedAt: new Date(),
      },
    });
  }

  for (const evalResult of evaluations) {
    const participation = execution.participations.find((p) => p.agentId === evalResult.agentId);
    if (!participation) continue;

    const scoresHistory = JSON.parse(participation.scoresJson || '[]');
    scoresHistory.push({
      round: execution.currentRound,
      score: evalResult.overallScore,
      dimensions: evalResult.dimensions,
    });

    const newBestScore = participation.bestScore 
      ? Math.max(participation.bestScore, evalResult.overallScore)
      : evalResult.overallScore;

    let newStatus: ParticipationStatus = ParticipationStatus.REVISING;
    if (!evalResult.shouldContinue) {
      newStatus = ParticipationStatus.ELIMINATED;
    } else if (execution.currentRound >= execution.maxRounds) {
      newStatus = ParticipationStatus.COMPLETED;
    }

    await db.agentParticipation.update({
      where: { id: participation.id },
      data: {
        status: newStatus,
        bestScore: newBestScore,
        scoresJson: JSON.stringify(scoresHistory),
        eliminatedAt: newStatus === ParticipationStatus.ELIMINATED ? new Date() : null,
        completedAt: newStatus === ParticipationStatus.COMPLETED ? new Date() : null,
        lastActiveAt: new Date(),
      },
    });
  }

  const roundCost = evaluations.reduce((sum: number, e) => sum + (e.costUsd || 0), 0);
  const roundTokens = evaluations.reduce((sum: number, e) => sum + (e.tokensUsed || 0), 0);
  await db.taskExecution.update({
    where: { id: executionId },
    data: {
      totalCost: { increment: roundCost },
      totalTokens: { increment: roundTokens },
    },
  });

  const shouldContinue = await shouldContinueToNextRound(executionId);
  
  if (shouldContinue) {
    await proceedToNextRound(executionId);
  } else {
    await finalizeExecution(executionId);
  }
}

async function shouldContinueToNextRound(executionId: string): Promise<boolean> {
  const execution = await db.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) return false;

  if (execution.currentRound >= execution.maxRounds) {
    console.log(`[Orchestrator] Max rounds (${execution.maxRounds}) reached`);
    return false;
  }

  const bestEvaluations = await db.evaluation.groupBy({
    by: ['agentId'],
    where: { taskExecutionId: executionId, status: EvaluationStatus.COMPLETED },
    _max: { overallScore: true },
  });

  const maxScore = Math.max(...bestEvaluations.map((e) => e._max.overallScore || 0));
  if (maxScore >= execution.minScoreThreshold) {
    console.log(`[Orchestrator] Score threshold met (${maxScore} >= ${execution.minScoreThreshold})`);
    return false;
  }

  return true;
}

async function proceedToNextRound(executionId: string): Promise<void> {
  // Fetch currentRound separately first to avoid self-referencing execution
  // inside its own findUnique call (temporal dead zone).
  const executionRound = await db.taskExecution.findUnique({
    where: { id: executionId },
    select: { currentRound: true },
  });

  if (!executionRound) return;

  const execution = await db.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: true,
      evaluations: { where: { round: executionRound.currentRound }, orderBy: { overallScore: 'desc' } },
    },
  });

  if (!execution) return;

  const nextRound = execution.currentRound + 1;
  console.log(`[Orchestrator] Proceeding to round ${nextRound}`);

  const feedbackMap: Record<string, string> = {};
  for (const evalItem of execution.evaluations) {
    if (evalItem.feedback) feedbackMap[evalItem.agentId] = evalItem.feedback;
  }

  await db.taskExecution.update({
    where: { id: executionId },
    data: { status: ExecutionStatus.REVISING, currentRound: nextRound },
  });

  const participations = await db.agentParticipation.findMany({
    where: { taskExecutionId: executionId },
    include: { agent: true },
  });

  for (const part of participations) {
    if (part.status === ParticipationStatus.ELIMINATED) continue;

    const feedback = feedbackMap[part.agentId];
    
    await db.agentParticipation.update({
      where: { id: part.id },
      data: { status: ParticipationStatus.REVISING, currentRound: nextRound, lastActiveAt: new Date() },
    });

    try {
      const apiToken = await getAgentApiToken(part.agentId);
      if (!apiToken) continue;

      const result = await dispatchMultiAgentRound(
        part.agent,
        execution.task,
        executionId,
        nextRound,
        apiToken,
        feedback,
      );

      if (!result.success) {
        console.error(`[Orchestrator] Failed to dispatch revision to agent ${part.agentId}: ${result.error}`);
      }
    } catch (error) {
      console.error(`[Orchestrator] Failed to notify agent ${part.agentId}:`, error);
    }
  }
}

async function finalizeExecution(executionId: string): Promise<void> {
  const execution = await db.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: true,
      submissions: { orderBy: { version: 'desc' } },
      evaluations: { orderBy: { overallScore: 'desc' } },
      participations: true,
    },
  });

  if (!execution) return;

  console.log(`[Orchestrator] Finalizing execution ${executionId}`);

  let winnerAgentId: string | null = null;
  let mergedOutput: string | null = null;

  if (execution.selectionMode === SelectionMode.MERGED_OUTPUT) {
    const topSubmissions = execution.evaluations
      .filter((e) => e.isBestInRound)
      .slice(0, 3)
      .map((e) => execution.submissions.find((s) => s.agentId === e.agentId))
      .filter(Boolean);

    if (topSubmissions.length > 0) {
      mergedOutput = topSubmissions.map((s) => s?.content).join('\n\n---\n\n');
    }
  } else {
    const winnerEval = execution.evaluations[0];
    if (winnerEval) winnerAgentId = winnerEval.agentId;
  }

  await db.taskExecution.update({
    where: { id: executionId },
    data: {
      status: ExecutionStatus.COMPLETED,
      winnerAgentId,
      mergedOutput,
      completedAt: new Date(),
    },
  });

  await db.task.update({
    where: { id: execution.taskId },
    data: { status: 'IN_REVIEW' },
  });

  await handlePayments(execution);
  await notifyParticipantsOfResult(executionId, winnerAgentId);
}

async function handlePayments(execution: any): Promise<void> {
  const escrow = await db.escrow.findUnique({ where: { taskId: execution.taskId } });

  if (!escrow || escrow.status !== 'LOCKED') {
    console.log('[Orchestrator] No locked escrow to distribute');
    return;
  }

  if (execution.selectionMode === SelectionMode.WINNER_TAKE_ALL) {
    console.log('[Orchestrator] Winner takes all - payment on user approval');
  } else if (execution.selectionMode === SelectionMode.SPLIT_PAYMENT) {
    const topEvals = execution.evaluations.slice(0, 3);
    const percentPerAgent = 100 / topEvals.length;

    for (const evalItem of topEvals) {
      const part = execution.participations.find((p: any) => p.agentId === evalItem.agentId);
      if (part) {
        await db.agentParticipation.update({
          where: { id: part.id },
          data: {
            rewardClaimed: escrow.amount * (percentPerAgent / 100),
            rewardPercent: percentPerAgent,
          },
        });
      }
    }
  }
}

async function notifyParticipantsOfResult(executionId: string, winnerAgentId: string | null): Promise<void> {
  const execution = await db.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: true,
      participations: { include: { agent: true } },
    },
  });

  if (!execution) return;

  for (const part of execution.participations) {
    try {
      const apiToken = await getAgentApiToken(part.agentId);
      if (!apiToken) continue;

      // Send a final-round notification (round = maxRounds) so agents know the competition ended.
      // The isWinner flag is carried in the payload type — winners get MULTI_AGENT_ROUND with
      // a "COMPLETED" instruction; losers get the same so they can log the outcome.
      const instruction = part.agentId === winnerAgentId
        ? 'Competition complete — you have been selected as the winner. Await payment release.'
        : 'Competition complete — thank you for participating. Your submission has been reviewed.';

      const result = await dispatchMultiAgentRound(
        part.agent,
        execution.task,
        executionId,
        execution.currentRound,
        apiToken,
        instruction,
      );

      if (!result.success) {
        console.error(`[Orchestrator] Failed to notify agent ${part.agentId} of result: ${result.error}`);
      }
    } catch (error) {
      console.error(`[Orchestrator] Failed to notify agent ${part.agentId}:`, error);
    }
  }
}

async function failExecution(executionId: string, reason: string): Promise<void> {
  await db.taskExecution.update({
    where: { id: executionId },
    data: { status: ExecutionStatus.FAILED, completedAt: new Date() },
  });
  console.log(`[Orchestrator] Execution failed: ${reason}`);
}

export async function getExecutionStatus(executionId: string) {
  const execution = await db.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: true,
      participations: { include: { agent: true } },
      submissions: { orderBy: { version: 'asc' } },
      evaluations: { orderBy: { overallScore: 'desc' } },
    },
  });

  if (!execution) return null;

  return {
    id: execution.id,
    taskId: execution.taskId,
    status: execution.status,
    currentRound: execution.currentRound,
    maxRounds: execution.maxRounds,
    selectionMode: execution.selectionMode,
    winnerAgentId: execution.winnerAgentId,
    totalCost: execution.totalCost,
    totalTokens: execution.totalTokens,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    task: { id: execution.task.id, title: execution.task.title, reward: execution.task.reward },
    participants: execution.participations.map((p) => ({
      agentId: p.agentId,
      agentName: p.agent.name,
      status: p.status,
      currentRound: p.currentRound,
      bestScore: p.bestScore,
    })),
    latestSubmissions: execution.submissions.map((s) => ({
      id: s.id,
      agentId: s.agentId,
      version: s.version,
      content: s.content.substring(0, 200) + '...',
      createdAt: s.createdAt,
    })),
    evaluations: execution.evaluations.map((e) => ({
      round: e.round,
      agentId: e.agentId,
      overallScore: e.overallScore,
      feedback: e.feedback,
      isBestInRound: e.isBestInRound,
    })),
  };
}

export async function timeoutAgentParticipation(executionId: string, agentId: string): Promise<void> {
  const participation = await db.agentParticipation.findFirst({
    where: { taskExecutionId: executionId, agentId },
  });

  if (!participation) return;

  await db.agentParticipation.update({
    where: { id: participation.id },
    data: { status: ParticipationStatus.ELIMINATED, eliminatedAt: new Date() },
  });

  const execution = await db.taskExecution.findUnique({
    where: { id: executionId },
    include: { participations: true },
  });

  if (!execution) return;

  const activeAgents = execution.participations.filter(
    (p) => p.status !== ParticipationStatus.ELIMINATED && p.status !== ParticipationStatus.COMPLETED
  );

  if (activeAgents.length < 2) {
    await finalizeExecution(executionId);
  } else {
    await checkRoundCompletion(executionId);
  }
}