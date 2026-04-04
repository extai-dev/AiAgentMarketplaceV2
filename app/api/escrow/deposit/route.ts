/**
 * POST /api/escrow/deposit
 * 
 * Deposit funds into escrow for a task.
 * This locks the funds for the agent to complete the work.
 * 
 * Body:
 * - taskId: the task to deposit funds for
 * - amount: amount to deposit
 * - token: token symbol (default: USDC)
 * - txHash: blockchain transaction hash
 */

import { NextRequest, NextResponse } from 'next/server';
import { SelectionMode } from '@prisma/client';
import { db } from '@/lib/db';
import { lockEscrowFunds, getEscrowByTaskId } from '@/lib/services/escrow-service';
import { emit } from '@/lib/events/eventBus';
import { EVENTS, EscrowLockedEvent } from '@/lib/events/events';
import { registerAllHandlers } from '@/lib/events/handlers';
import { startMultiAgentExecution } from '@/lib/services/multi-agent-orchestrator';
import { signPayload, decryptApiToken } from '@/lib/agent-crypto';

// Initialize event handlers on first request
let handlersInitialized = false;
function ensureHandlersInitialized() {
  if (!handlersInitialized) {
    registerAllHandlers();
    handlersInitialized = true;
  }
}

export async function POST(request: NextRequest) {
  try {
    ensureHandlersInitialized();

    const body = await request.json();
    const { taskId, amount, token = 'USDC', txHash } = body;

    // Validation
    if (!taskId || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid taskId or amount' },
        { status: 400 }
      );
    }

    // Get escrow for this task
    const escrowResult = await getEscrowByTaskId(taskId);
    if (!escrowResult.success || !escrowResult.escrow) {
      return NextResponse.json(
        { success: false, error: 'No escrow found for this task' },
        { status: 404 }
      );
    }

    // Lock the escrow funds
    const lockResult = await lockEscrowFunds({
      taskId,
      amount: amount.toString(),
      txHash,
    });

    if (!lockResult.success) {
      return NextResponse.json(
        { success: false, error: lockResult.error },
        { status: 400 }
      );
    }

    // Emit ESCROW_LOCKED event
    const event: EscrowLockedEvent = {
      escrowId: escrowResult.escrow.id,
      taskId,
      txHash,
    };
    await emit(EVENTS.ESCROW_LOCKED, event).catch(console.error);

    // Auto-start multi-agent execution if a pending config is stored on the task
    let executionData: { executionId: string; agentCount: number; maxRounds: number } | null = null;
    const task = await db.task.findUnique({ where: { id: taskId }, select: { multiAgentEnabled: true, multiAgentConfig: true, taskExecution: { select: { id: true } } } });
    if (task?.multiAgentEnabled && task.multiAgentConfig && !task.taskExecution) {
      try {
        const cfg = JSON.parse(task.multiAgentConfig) as {
          agentIds: string[];
          maxRounds: number;
          minScoreThreshold: number;
          selectionMode: string;
          judgeModel: string;
          judgeProvider: string;
        };
        console.log(`[EscrowDeposit] Auto-starting multi-agent execution for task ${taskId}`);
        const result = await startMultiAgentExecution({
          taskId,
          agentIds: cfg.agentIds,
          maxRounds: cfg.maxRounds,
          minScoreThreshold: cfg.minScoreThreshold,
          selectionMode: cfg.selectionMode as SelectionMode,
          judgeModel: cfg.judgeModel,
          judgeProvider: cfg.judgeProvider,
        });
        if (result.success) {
          executionData = { executionId: result.executionId!, agentCount: cfg.agentIds.length, maxRounds: cfg.maxRounds };
          console.log(`[EscrowDeposit] Multi-agent execution started: ${result.executionId}`);
        } else {
          console.error(`[EscrowDeposit] Failed to auto-start multi-agent execution: ${result.error}`);
        }
      } catch (parseError) {
        console.error('[EscrowDeposit] Failed to parse multiAgentConfig:', parseError);
      }
    }

    // ── Single-agent: auto-accept the first PENDING bid now that escrow is locked ──
    let acceptedBid: { id: string; agentId: string; amount: number } | null = null;
    if (!task?.multiAgentEnabled) {
      const pendingBid = await db.bid.findFirst({
        where: { taskId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        include: {
          agent: {
            select: { id: true, name: true, execUrl: true, apiTokenEncrypted: true, apiTokenHash: true },
          },
        },
      });

      if (pendingBid) {
        // Atomically accept the bid and move task to IN_PROGRESS
        await db.$transaction([
          db.bid.update({ where: { id: pendingBid.id }, data: { status: 'ACCEPTED' } }),
          db.task.update({
            where: { id: taskId },
            data: { agentId: pendingBid.agentId, status: 'IN_PROGRESS' },
          }),
          db.agent.update({
            where: { id: pendingBid.agentId },
            data: { acceptedBids: { increment: 1 } },
          }),
        ]);

        await db.agentLog.create({
          data: {
            agentId: pendingBid.agentId,
            level: 'INFO',
            action: 'BID_AUTO_ACCEPTED',
            taskId,
            message: 'Bid auto-accepted after escrow deposit.',
          },
        });

        acceptedBid = { id: pendingBid.id, agentId: pendingBid.agentId, amount: pendingBid.amount };

        // Notify the agent via webhook (best-effort)
        if (pendingBid.agent.execUrl) {
          try {
            let apiToken: string;
            if (pendingBid.agent.apiTokenEncrypted) {
              apiToken = decryptApiToken(pendingBid.agent.apiTokenEncrypted);
            } else {
              apiToken = pendingBid.agent.apiTokenHash || 'default-signing-key';
            }

            const fullTask = await db.task.findUnique({
              where: { id: taskId },
              include: { creator: { select: { walletAddress: true, name: true } } },
            });

            if (fullTask) {
              const webhookPayload = {
                type: 'BID_ACCEPTED',
                timestamp: new Date().toISOString(),
                notificationId: `escrow-accept-${pendingBid.id}-${Date.now()}`,
                agent: { id: pendingBid.agent.id, name: pendingBid.agent.name },
                task: {
                  id: fullTask.id,
                  numericId: fullTask.numericId,
                  title: fullTask.title,
                  description: fullTask.description,
                  reward: fullTask.reward,
                  tokenSymbol: fullTask.tokenSymbol,
                  status: fullTask.status,
                  deadline: fullTask.deadline ? fullTask.deadline.toISOString() : null,
                  escrowDeposited: true,
                  creator: { walletAddress: fullTask.creator.walletAddress, name: fullTask.creator.name },
                },
                bid: { id: pendingBid.id, amount: pendingBid.amount, message: pendingBid.message },
              };

              const signature = signPayload(webhookPayload, apiToken);
              fetch(pendingBid.agent.execUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Agent-ID': pendingBid.agent.id,
                  'X-Signature': signature,
                  'X-Notification-ID': webhookPayload.notificationId,
                },
                body: JSON.stringify(webhookPayload),
                signal: AbortSignal.timeout(10000),
              }).catch((err: Error) => {
                console.warn(`[EscrowDeposit] BID_ACCEPTED webhook failed for agent ${pendingBid.agentId}:`, err.message);
              });
            }
          } catch (webhookErr) {
            console.warn('[EscrowDeposit] Failed to send BID_ACCEPTED webhook:', webhookErr);
          }
        }
      }
    }
    // ── End single-agent auto-accept ──────────────────────────────────────────

    return NextResponse.json({
      success: true,
      data: lockResult.escrow,
      message: 'Escrow funds locked successfully',
      ...(executionData && { execution: executionData }),
      ...(acceptedBid && { acceptedBid }),
    });
  } catch (error) {
    console.error('Error locking escrow:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to lock escrow funds' },
      { status: 500 }
    );
  }
}
