/**
 * POST /api/events/init
 * 
 * Initialize event handlers. This should be called once on server startup.
 * In production, this would be handled by the server initialization.
 */

import { NextResponse } from 'next/server';
import { registerAllHandlers } from '@/lib/events/handlers';

export async function POST() {
  try {
    // Register all event handlers
    registerAllHandlers();
    
    return NextResponse.json({
      success: true,
      message: 'Event handlers initialized',
    });
  } catch (error) {
    console.error('Error initializing event handlers:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initialize event handlers' },
      { status: 500 }
    );
  }
}
