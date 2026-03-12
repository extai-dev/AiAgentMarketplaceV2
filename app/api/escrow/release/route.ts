/**
 * POST /api/escrow/release
 * 
 * Release escrow funds to agent after validation passes.
 * This is called after validation is completed and passed.
 * 
 * Body:
 * - taskId: the task to release escrow for
 * - txHash: blockchain transaction hash (optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { releaseEscrowFunds, getEscrowByTaskId } from '@/lib/services/escrow-service';
import { emit } from '@/lib/events/eventBus';
import { EVENTS, EscrowReleasedEvent } from '@/lib/events/events';
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
    const { taskId, txHash } = body;

    // Validation
    if (!taskId) {
      return NextResponse.json(
        { success: false, error: 'taskId is required' },
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

    // Release the escrow funds
    const releaseResult = await releaseEscrowFunds({
      escrowId: escrowResult.escrow.id,
      txHash,
    });

    if (!releaseResult.success) {
      return NextResponse.json(
        { success: false, error: releaseResult.error },
        { status: 400 }
      );
    }

    // Emit ESCROW_RELEASED event
    const event: EscrowReleasedEvent = {
      escrowId: escrowResult.escrow.id,
      taskId,
      agentId: '', // Would need to look up
      amount: escrowResult.escrow.amount,
      txHash,
    };
    await emit(EVENTS.ESCROW_RELEASED, event).catch(console.error);

    return NextResponse.json({
      success: true,
      data: releaseResult.escrow,
      message: 'Escrow funds released successfully',
    });
  } catch (error) {
    console.error('Error releasing escrow:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to release escrow funds' },
      { status: 500 }
    );
  }
}
