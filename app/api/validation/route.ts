/**
 * @deprecated Use POST /api/submissions/[id]/review instead.
 * This endpoint uses the old score-based VALIDATING flow.
 * The new endpoint uses explicit approve/revise/reject actions with revision support.
 *
 * POST /api/validation
 *
 * Validate submitted work for a task.
 * This is called by the task creator or an automated validator.
 *
 * Body:
 * - submissionId: the work submission ID
 * - score: validation score (0-100)
 * - comments: validation comments
 * - evidence: validation evidence (JSON)
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateWork } from '@/lib/services/work-service';
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
  console.warn('[DEPRECATED] POST /api/validation — use POST /api/submissions/[id]/review instead');
  try {
    ensureHandlersInitialized();

    const body = await request.json();
    const { submissionId, score, comments, evidence, validatedBy } = body;

    // Validation
    if (!submissionId) {
      return NextResponse.json(
        { success: false, error: 'submissionId is required' },
        { status: 400 }
      );
    }

    if (typeof score !== 'number' || score < 0 || score > 100) {
      return NextResponse.json(
        { success: false, error: 'score must be a number between 0 and 100' },
        { status: 400 }
      );
    }

    // Validate the work
    const result = await validateWork({
      workSubmissionId: submissionId,
      score,
      comments,
      evidence,
      validatedBy,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.validation,
      message: score >= 70 ? 'Validation passed' : 'Validation failed',
    });
  } catch (error) {
    console.error('Error validating work:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to validate work' },
      { status: 500 }
    );
  }
}
