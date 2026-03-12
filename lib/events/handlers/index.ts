/**
 * Event Handlers Index
 * 
 * Import and register all event handlers
 */

import { registerNotifyAgentsHandlers } from './notifyAgents';
import { registerEscrowReleaseHandlers } from './escrowRelease';
import { registerValidationHandlers } from './validationHandler';
import { registerReputationHandlers } from './reputationUpdate';

/**
 * Register all event handlers
 * Call this once at application startup
 */
export function registerAllHandlers(): void {
  console.log('[Events] Registering all event handlers...');
  
  registerNotifyAgentsHandlers();
  registerEscrowReleaseHandlers();
  registerValidationHandlers();
  registerReputationHandlers();
  
  console.log('[Events] All handlers registered');
}

// Export individual handlers for selective registration
export { registerNotifyAgentsHandlers } from './notifyAgents';
export { registerEscrowReleaseHandlers } from './escrowRelease';
export { registerValidationHandlers } from './validationHandler';
export { registerReputationHandlers } from './reputationUpdate';
