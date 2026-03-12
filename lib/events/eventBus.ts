/**
 * Event Bus - Internal Event System
 * 
 * Simple in-memory event bus for event-driven orchestration.
 * Services emit events, handlers react to them.
 * 
 * Events flow:
 * TASK_CREATED → Agents discover → BID_SUBMITTED → BID_ACCEPTED → 
 * ESCROW_LOCKED → WORK_SUBMITTED → VALIDATION_COMPLETED → 
 * ESCROW_RELEASED → TASK_COMPLETED → REPUTATION_UPDATED
 */

type EventHandler<T = any> = (payload: T) => void | Promise<void>;

interface EventSubscription {
  handler: EventHandler;
  once?: boolean;
}

/**
 * Event Bus Class
 * Singleton pattern for global event bus
 */
class EventBusClass {
  private handlers: Map<string, EventSubscription[]> = new Map();
  private eventHistory: Array<{ event: string; payload: any; timestamp: Date }> = [];
  private maxHistorySize = 100;

  /**
   * Subscribe to an event
   */
  subscribe<T>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    
    const subscription: EventSubscription = { handler: handler as EventHandler };
    this.handlers.get(event)!.push(subscription);
    
    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(subscription);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Subscribe to an event once (auto-unsubscribe after first emit)
   */
  once<T>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    
    const subscription: EventSubscription = { handler: handler as EventHandler, once: true };
    this.handlers.get(event)!.push(subscription);
    
    return () => {
      const handlers = this.handlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(subscription);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Emit an event with payload
   */
  async emit<T>(event: string, payload: T): Promise<void> {
    // Store in history
    this.eventHistory.push({ event, payload, timestamp: new Date() });
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    const handlers = this.handlers.get(event);
    if (!handlers || handlers.length === 0) {
      console.log(`[EventBus] No handlers for event: ${event}`);
      return;
    }

    console.log(`[EventBus] Emitting ${event} to ${handlers.length} handlers`);

    // Call handlers
    const promises: Promise<void>[] = [];
    const toRemove: EventSubscription[] = [];

    for (const subscription of handlers) {
      const result = subscription.handler(payload);
      
      if (result instanceof Promise) {
        promises.push(result);
      }

      // Remove 'once' handlers after execution
      if (subscription.once) {
        toRemove.push(subscription);
      }
    }

    // Wait for all handlers
    await Promise.all(promises);

    // Remove once-handlers
    for (const subscription of toRemove) {
      const index = handlers.indexOf(subscription);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Get all handlers for an event
   */
  getHandlers(event: string): EventSubscription[] {
    return this.handlers.get(event) || [];
  }

  /**
   * Get event history
   */
  getHistory(limit?: number): Array<{ event: string; payload: any; timestamp: Date }> {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear();
    this.eventHistory = [];
  }

  /**
   * Remove all handlers for an event
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: string): number {
    return this.handlers.get(event)?.length || 0;
  }
}

// Singleton instance
export const eventBus = new EventBusClass();

// Helper function for easy event emitting
export const emit = <T>(event: string, payload: T): Promise<void> => {
  return eventBus.emit(event, payload);
};

// Helper for subscribing
export const on = <T>(event: string, handler: EventHandler<T>): (() => void) => {
  return eventBus.subscribe(event, handler);
};

// Helper for subscribing once
export const once = <T>(event: string, handler: EventHandler<T>): (() => void) => {
  return eventBus.once(event, handler);
};
