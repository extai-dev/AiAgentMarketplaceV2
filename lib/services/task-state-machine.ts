/**
 * Task State Machine
 * 
 * Defines the valid state transitions for tasks in the marketplace.
 * Each state can transition to specific next states.
 * 
 * State Flow:
 * CREATED → OPEN → BIDDING → ASSIGNED → IN_PROGRESS → SUBMITTED → VALIDATING → COMPLETE
 *                                              ↓                    ↓
 *                                            FAILED              DISPUTED
 *                                              ↓
 *                                           CANCELLED
 */

import { TaskStatus } from '@prisma/client';

// Define valid transitions from each state
export const TASK_STATE_MACHINE: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.CREATED]: [TaskStatus.OPEN, TaskStatus.CANCELLED],
  [TaskStatus.OPEN]: [TaskStatus.BIDDING, TaskStatus.CANCELLED],
  [TaskStatus.BIDDING]: [TaskStatus.ASSIGNED, TaskStatus.CANCELLED],
  [TaskStatus.ASSIGNED]: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.SUBMITTED, TaskStatus.FAILED, TaskStatus.CANCELLED],
  [TaskStatus.SUBMITTED]: [TaskStatus.VALIDATING, TaskStatus.DISPUTED],
  [TaskStatus.VALIDATING]: [TaskStatus.COMPLETE, TaskStatus.FAILED, TaskStatus.DISPUTED],
  [TaskStatus.COMPLETE]: [TaskStatus.DISPUTED],
  [TaskStatus.FAILED]: [TaskStatus.DISPUTED],
  [TaskStatus.DISPUTED]: [],
  [TaskStatus.CANCELLED]: [],
};

// Terminal states (no further transitions possible)
const TERMINAL_STATES = [
  TaskStatus.COMPLETE,
  TaskStatus.DISPUTED,
  TaskStatus.CANCELLED,
];

/**
 * Check if a state is terminal
 */
export function isTerminalState(status: TaskStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

/**
 * Check if transition to target state is allowed
 */
export function canTransitionTo(fromStatus: TaskStatus, toStatus: TaskStatus): boolean {
  const allowedTransitions = TASK_STATE_MACHINE[fromStatus];
  if (!allowedTransitions) {
    return false;
  }
  return allowedTransitions.includes(toStatus);
}

/**
 * Validate a state transition and return error message if invalid
 */
export function validateTransition(fromStatus: TaskStatus, toStatus: TaskStatus): string | null {
  // Same state is always valid (idempotent)
  if (fromStatus === toStatus) {
    return null;
  }

  // Check if transition is valid
  if (!canTransitionTo(fromStatus, toStatus)) {
    return `Invalid state transition from ${fromStatus} to ${toStatus}`;
  }

  return null;
}

/**
 * Get all possible states
 */
export function getAllStates(): TaskStatus[] {
  return Object.values(TaskStatus);
}

/**
 * Get all valid transitions from a given state
 */
export function getValidTransitions(fromStatus: TaskStatus): TaskStatus[] {
  return TASK_STATE_MACHINE[fromStatus] || [];
}

/**
 * Get state metadata
 */
export function getStateMetadata(status: TaskStatus): {
  label: string;
  description: string;
  color: string;
  isTerminal: boolean;
  isActive: boolean;
} {
  const metadata: Record<TaskStatus, {
    label: string;
    description: string;
    color: string;
    isTerminal: boolean;
    isActive: boolean;
  }> = {
    [TaskStatus.CREATED]: {
      label: 'Created',
      description: 'Task has been created but not published',
      color: 'gray',
      isTerminal: false,
      isActive: false,
    },
    [TaskStatus.OPEN]: {
      label: 'Open',
      description: 'Task is open for bidding',
      color: 'blue',
      isTerminal: false,
      isActive: true,
    },
    [TaskStatus.BIDDING]: {
      label: 'Bidding',
      description: 'Accepting bids from agents',
      color: 'yellow',
      isTerminal: false,
      isActive: true,
    },
    [TaskStatus.ASSIGNED]: {
      label: 'Assigned',
      description: 'Task has been assigned to an agent',
      color: 'purple',
      isTerminal: false,
      isActive: true,
    },
    [TaskStatus.IN_PROGRESS]: {
      label: 'In Progress',
      description: 'Agent is working on the task',
      color: 'orange',
      isTerminal: false,
      isActive: true,
    },
    [TaskStatus.SUBMITTED]: {
      label: 'Submitted',
      description: 'Agent has submitted work',
      color: 'cyan',
      isTerminal: false,
      isActive: true,
    },
    [TaskStatus.VALIDATING]: {
      label: 'Validating',
      description: 'Work is being validated',
      color: 'indigo',
      isTerminal: false,
      isActive: true,
    },
    [TaskStatus.COMPLETE]: {
      label: 'Complete',
      description: 'Task completed successfully',
      color: 'green',
      isTerminal: true,
      isActive: false,
    },
    [TaskStatus.FAILED]: {
      label: 'Failed',
      description: 'Task failed to complete',
      color: 'red',
      isTerminal: true,
      isActive: false,
    },
    [TaskStatus.DISPUTED]: {
      label: 'Disputed',
      description: 'Task is under dispute',
      color: 'pink',
      isTerminal: true,
      isActive: false,
    },
    [TaskStatus.CANCELLED]: {
      label: 'Cancelled',
      description: 'Task was cancelled',
      color: 'gray',
      isTerminal: true,
      isActive: false,
    },
  };

  return metadata[status];
}

// Export type for transitions
export type TaskTransition = {
  from: TaskStatus;
  to: TaskStatus;
  allowed: boolean;
};

// Get all possible transitions
export function getAllTransitions(): TaskTransition[] {
  const transitions: TaskTransition[] = [];
  
  for (const [from, targets] of Object.entries(TASK_STATE_MACHINE)) {
    for (const to of targets) {
      transitions.push({
        from: from as TaskStatus,
        to,
        allowed: true,
      });
    }
  }
  
  return transitions;
}
