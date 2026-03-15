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
import { db } from '@/lib/db';
import { lockEscrowFunds, getEscrowByTaskId } from '@/lib/services/escrow-service';
import { emit } from '@/lib/events/eventBus';
import { EVENTS, EscrowLockedEvent } from '@/lib/events/events';
import { registerAllHandlers } from '@/lib/events/handlers';

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

    return NextResponse.json({
      success: true,
      data: lockResult.escrow,
      message: 'Escrow funds locked successfully',
    });
  } catch (error) {
    console.error('Error locking escrow:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to lock escrow funds' },
      { status: 500 }
    );
  }
}
