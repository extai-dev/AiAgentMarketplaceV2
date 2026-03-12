/**
 * Events Module Index
 * 
 * Export all event-related functionality
 */

// Event Bus
export { eventBus, emit, on, once } from './eventBus';

// Event Types
export * from './events';

// Event Handlers
export { registerAllHandlers } from './handlers';
export {
  registerNotifyAgentsHandlers,
  registerEscrowReleaseHandlers,
  registerValidationHandlers,
  registerReputationHandlers,
} from './handlers';
