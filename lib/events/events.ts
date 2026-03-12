/**
 * Marketplace Events
 * 
 * All events emitted by services and handled by event handlers.
 * Follows the marketplace workflow:
 * 
 * TASK_CREATED → Agents discover → BID_SUBMITTED → BID_ACCEPTED → 
 * ESCROW_LOCKED → WORK_SUBMITTED → VALIDATION_COMPLETED → 
 * ESCROW_RELEASED → TASK_COMPLETED → REPUTATION_UPDATED
 */

// ============== TASK EVENTS ==============

export interface TaskCreatedEvent {
  taskId: string;
  numericId: number;
  title: string;
  description: string;
  reward: number;
  tokenSymbol: string;
  creatorId: string;
  creatorWallet: string;
  deadline?: Date;
}

export interface TaskPublishedEvent {
  taskId: string;
  numericId: number;
}

export interface TaskAssignedEvent {
  taskId: string;
  agentId: string;
  agentWallet: string;
  bidId?: string;
}

export interface TaskStartedEvent {
  taskId: string;
  agentId: string;
}

export interface TaskSubmittedEvent {
  taskId: string;
  agentId: string;
  submissionId: string;
  resultUri?: string;
}

export interface TaskValidationStartedEvent {
  taskId: string;
  submissionId: string;
}

export interface TaskValidationCompletedEvent {
  taskId: string;
  submissionId: string;
  passed: boolean;
  score: number;
  comments?: string;
}

export interface TaskCompletedEvent {
  taskId: string;
  agentId: string;
  resultHash?: string;
}

export interface TaskFailedEvent {
  taskId: string;
  reason: string;
}

export interface TaskCancelledEvent {
  taskId: string;
  reason?: string;
}

// ============== BID EVENTS ==============

export interface BidSubmittedEvent {
  bidId: string;
  taskId: string;
  agentId: string;
  amount: number;
  message?: string;
}

export interface BidAcceptedEvent {
  bidId: string;
  taskId: string;
  agentId: string;
  agentWallet: string;
}

export interface BidRejectedEvent {
  bidId: string;
  taskId: string;
  agentId: string;
}

// ============== ESCROW EVENTS ==============

export interface EscrowCreatedEvent {
  escrowId: string;
  taskId: string;
  payer: string;
  agentWallet: string;
  amount: number;
  token: string;
}

export interface EscrowLockedEvent {
  escrowId: string;
  taskId: string;
  txHash?: string;
}

export interface EscrowReleasedEvent {
  escrowId: string;
  taskId: string;
  agentId: string;
  amount: number;
  txHash?: string;
}

export interface EscrowRefundedEvent {
  escrowId: string;
  taskId: string;
  reason?: string;
  txHash?: string;
}

export interface EscrowDisputedEvent {
  escrowId: string;
  taskId: string;
  reason?: string;
}

// ============== AGENT EVENTS ==============

export interface AgentRegisteredEvent {
  agentId: string;
  erc8004AgentId?: string;
  walletAddress: string;
  name: string;
}

export interface AgentDiscoveredTaskEvent {
  agentId: string;
  taskId: string;
}

export interface AgentExecutingTaskEvent {
  agentId: string;
  taskId: string;
}

// ============== VALIDATION EVENTS ==============

export interface ValidationStartedEvent {
  taskId: string;
  submissionId: string;
  validatorId?: string;
}

export interface ValidationCompletedEvent {
  taskId: string;
  submissionId: string;
  validatorId?: string;
  passed: boolean;
  score: number;
  comments?: string;
}

// ============== REPUTATION EVENTS ==============

export interface ReputationUpdatedEvent {
  agentId: string;
  taskId?: string;
  score: number;
  totalRatings: number;
  averageRating: number;
}

// ============== EVENT NAMES ==============

export const EVENTS = {
  // Task events
  TASK_CREATED: 'TASK_CREATED',
  TASK_PUBLISHED: 'TASK_PUBLISHED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_STARTED: 'TASK_STARTED',
  TASK_SUBMITTED: 'TASK_SUBMITTED',
  TASK_VALIDATION_STARTED: 'TASK_VALIDATION_STARTED',
  TASK_VALIDATION_COMPLETED: 'TASK_VALIDATION_COMPLETED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_FAILED: 'TASK_FAILED',
  TASK_CANCELLED: 'TASK_CANCELLED',

  // Bid events
  BID_SUBMITTED: 'BID_SUBMITTED',
  BID_ACCEPTED: 'BID_ACCEPTED',
  BID_REJECTED: 'BID_REJECTED',

  // Escrow events
  ESCROW_CREATED: 'ESCROW_CREATED',
  ESCROW_LOCKED: 'ESCROW_LOCKED',
  ESCROW_RELEASED: 'ESCROW_RELEASED',
  ESCROW_REFUNDED: 'ESCROW_REFUNDED',
  ESCROW_DISPUTED: 'ESCROW_DISPUTED',

  // Agent events
  AGENT_REGISTERED: 'AGENT_REGISTERED',
  AGENT_DISCOVERED_TASK: 'AGENT_DISCOVERED_TASK',
  AGENT_EXECUTING_TASK: 'AGENT_EXECUTING_TASK',

  // Validation events
  VALIDATION_STARTED: 'VALIDATION_STARTED',
  VALIDATION_COMPLETED: 'VALIDATION_COMPLETED',

  // Reputation events
  REPUTATION_UPDATED: 'REPUTATION_UPDATED',
} as const;

// Type for all event names
export type EventName = typeof EVENTS[keyof typeof EVENTS];

// Type for all event payloads
export type EventPayload = 
  | TaskCreatedEvent
  | TaskPublishedEvent
  | TaskAssignedEvent
  | TaskStartedEvent
  | TaskSubmittedEvent
  | TaskValidationStartedEvent
  | TaskValidationCompletedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent
  | BidSubmittedEvent
  | BidAcceptedEvent
  | BidRejectedEvent
  | EscrowCreatedEvent
  | EscrowLockedEvent
  | EscrowReleasedEvent
  | EscrowRefundedEvent
  | EscrowDisputedEvent
  | AgentRegisteredEvent
  | AgentDiscoveredTaskEvent
  | AgentExecutingTaskEvent
  | ValidationStartedEvent
  | ValidationCompletedEvent
  | ReputationUpdatedEvent;
