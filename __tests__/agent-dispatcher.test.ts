/**
 * Agent Dispatcher Unit Tests
 * 
 * Tests for the task matching and dispatch logic
 */

import { matchesCriteria, AgentCriteria } from '@/lib/agent-dispatcher';

describe('Agent Dispatcher - Criteria Matching', () => {
  const mockTask = {
    title: 'AI Data Analysis Project',
    description: 'Need machine learning analysis for customer data',
    reward: 100,
    escrowDeposited: true,
  };

  describe('Reward matching', () => {
    it('should match when reward is above minimum', () => {
      const criteria: AgentCriteria = { minReward: 50 };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });

    it('should not match when reward is below minimum', () => {
      const criteria: AgentCriteria = { minReward: 150 };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(false);
      expect(result.reason).toContain('below minimum');
    });

    it('should match when reward is below maximum', () => {
      const criteria: AgentCriteria = { maxReward: 200 };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });

    it('should not match when reward is above maximum', () => {
      const criteria: AgentCriteria = { maxReward: 50 };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(false);
      expect(result.reason).toContain('above maximum');
    });

    it('should match within reward range', () => {
      const criteria: AgentCriteria = { minReward: 50, maxReward: 200 };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });
  });

  describe('Keyword matching', () => {
    it('should match when keyword is in title', () => {
      const criteria: AgentCriteria = { keywords: ['AI'] };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });

    it('should match when keyword is in description', () => {
      const criteria: AgentCriteria = { keywords: ['machine learning'] };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });

    it('should match any keyword from list', () => {
      const criteria: AgentCriteria = { keywords: ['python', 'data', 'javascript'] };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });

    it('should not match when no keywords found', () => {
      const criteria: AgentCriteria = { keywords: ['python', 'javascript'] };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(false);
      expect(result.reason).toContain('No matching keywords');
    });

    it('should be case-insensitive', () => {
      const criteria: AgentCriteria = { keywords: ['DATA'] };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });
  });

  describe('Exclude keywords', () => {
    it('should not match when exclude keyword is present', () => {
      const task = {
        ...mockTask,
        title: 'Spam Detection Project',
      };
      const criteria: AgentCriteria = { excludeKeywords: ['spam'] };
      const result = matchesCriteria(task, criteria);
      expect(result.matches).toBe(false);
      expect(result.reason).toContain('excluded keyword');
    });

    it('should match when exclude keyword is not present', () => {
      const criteria: AgentCriteria = { excludeKeywords: ['blockchain', 'crypto'] };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });
  });

  describe('Escrow requirement', () => {
    it('should match when escrow is required and deposited', () => {
      const criteria: AgentCriteria = { requireEscrow: true };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });

    it('should not match when escrow is required but not deposited', () => {
      const task = { ...mockTask, escrowDeposited: false };
      const criteria: AgentCriteria = { requireEscrow: true };
      const result = matchesCriteria(task, criteria);
      expect(result.matches).toBe(false);
      expect(result.reason).toContain('Escrow required');
    });
  });

  describe('Combined criteria', () => {
    it('should match all criteria', () => {
      const criteria: AgentCriteria = {
        minReward: 50,
        maxReward: 200,
        keywords: ['data', 'analysis'],
        requireEscrow: true,
      };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });

    it('should fail on first non-matching criterion', () => {
      const criteria: AgentCriteria = {
        minReward: 150, // Will fail here
        keywords: ['data'],
      };
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(false);
      expect(result.reason).toContain('below minimum');
    });

    it('should match with empty criteria', () => {
      const criteria: AgentCriteria = {};
      const result = matchesCriteria(mockTask, criteria);
      expect(result.matches).toBe(true);
    });
  });
});

// Export for test runner
export {};
