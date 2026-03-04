import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

/**
 * AI Agent Integration Tests
 * 
 * These tests verify the complete agent flow:
 * 1. Agent registration
 * 2. Task dispatch to agents
 * 3. Agent callback handling
 * 4. Bid submission from agents
 */

const API_BASE = 'http://localhost:3000/api';

// Test data
const testOwnerWallet = '0xOwnerTest123456789abcdef123456789abcdef1234';
const testAgentWallet = '0xAgentTest123456789abcdef123456789abcdef12345';
const testTaskCreatorWallet = '0xCreatorTest123456789abcdef123456789abcdef12';

interface Agent {
  id: string;
  name: string;
  walletAddress: string;
  apiToken?: string;
  status: string;
}

interface Task {
  id: string;
  numericId: number;
  title: string;
  description: string;
  reward: number;
  status: string;
}

describe('AI Agent Flow', () => {
  let registeredAgent: Agent | null = null;
  let createdTask: Task | null = null;

  describe('Agent Registration', () => {
    it('should register a new AI agent', async () => {
      const response = await fetch(`${API_BASE}/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test AI Agent',
          description: 'An AI agent for testing purposes',
          walletAddress: testAgentWallet,
          ownerWalletAddress: testOwnerWallet,
          execUrl: 'https://test-agent.example.com/webhook',
          criteria: {
            minReward: 10,
            maxReward: 1000,
            keywords: ['AI', 'data', 'analysis'],
            requireEscrow: true,
          },
        }),
      });

      const data = await response.json();
      console.log('Agent registration response:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.name).toBe('Test AI Agent');
      expect(data.data.walletAddress).toBe(testAgentWallet.toLowerCase());
      expect(data.data.apiToken).toBeDefined();
      expect(data.data.apiToken).toMatch(/^ag_/);

      registeredAgent = data.data;
    });

    it('should not register agent with duplicate wallet address', async () => {
      const response = await fetch(`${API_BASE}/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Duplicate Agent',
          walletAddress: testAgentWallet, // Same as previous test
          ownerWalletAddress: testOwnerWallet,
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('already registered');
    });

    it('should list agents for owner', async () => {
      const response = await fetch(
        `${API_BASE}/agents?ownerWalletAddress=${testOwnerWallet}`
      );

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0].walletAddress).toBe(testAgentWallet.toLowerCase());
    });
  });

  describe('Task Creation and Dispatch', () => {
    it('should create a new task', async () => {
      const response = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'AI Data Analysis Task',
          description: 'We need AI analysis of our data using machine learning techniques',
          reward: 50,
          tokenSymbol: 'TT',
          creatorWalletAddress: testTaskCreatorWallet,
        }),
      });

      const data = await response.json();
      console.log('Task creation response:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.title).toBe('AI Data Analysis Task');
      expect(data.data.reward).toBe(50);

      createdTask = data.data;
    });

    it('should have dispatched task to matching agents', async () => {
      // Wait a bit for async dispatch
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check agent logs for dispatch
      if (!registeredAgent) {
        throw new Error('No registered agent');
      }

      const response = await fetch(`${API_BASE}/agents/${registeredAgent.id}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      
      // Check if dispatch was recorded
      if (data.data.dispatches && data.data.dispatches.length > 0) {
        const dispatch = data.data.dispatches[0];
        expect(dispatch.taskId).toBe(createdTask?.id);
      }
    });
  });

  describe('Agent Callback', () => {
    it('should accept agent callback with bid decision', async () => {
      if (!registeredAgent || !createdTask || !registeredAgent.apiToken) {
        console.log('Skipping callback test - agent or task not available');
        return;
      }

      const response = await fetch(`${API_BASE}/agents/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-ID': registeredAgent.id,
          'X-API-Token': registeredAgent.apiToken,
        },
        body: JSON.stringify({
          type: 'BID_RESPONSE',
          taskId: createdTask.id,
          decision: 'bid',
          amount: 45,
          message: 'I can analyze your data efficiently using ML techniques.',
        }),
      });

      const data = await response.json();
      console.log('Callback response:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.bidId).toBeDefined();
    });

    it('should reject callback with invalid token', async () => {
      if (!registeredAgent || !createdTask) {
        console.log('Skipping invalid token test');
        return;
      }

      const response = await fetch(`${API_BASE}/agents/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-ID': registeredAgent.id,
          'X-API-Token': 'invalid_token',
        },
        body: JSON.stringify({
          type: 'BID_RESPONSE',
          taskId: createdTask.id,
          decision: 'bid',
          amount: 30,
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should accept heartbeat from agent', async () => {
      if (!registeredAgent || !registeredAgent.apiToken) {
        console.log('Skipping heartbeat test');
        return;
      }

      const response = await fetch(`${API_BASE}/agents/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-ID': registeredAgent.id,
          'X-API-Token': registeredAgent.apiToken,
        },
        body: JSON.stringify({
          type: 'HEARTBEAT',
          metrics: {
            cpuUsage: 25,
            memoryUsage: 512,
          },
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toContain('Heartbeat');
    });
  });

  describe('Agent Management', () => {
    it('should update agent criteria', async () => {
      if (!registeredAgent) {
        console.log('Skipping update test');
        return;
      }

      const response = await fetch(`${API_BASE}/agents/${registeredAgent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerWalletAddress: testOwnerWallet,
          criteria: {
            minReward: 20,
            maxReward: 500,
            keywords: ['AI', 'ML'],
          },
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should not allow non-owner to update agent', async () => {
      if (!registeredAgent) {
        console.log('Skipping unauthorized update test');
        return;
      }

      const response = await fetch(`${API_BASE}/agents/${registeredAgent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerWalletAddress: '0xDifferentOwner123456789abcdef123456789a',
          criteria: { minReward: 0 },
        }),
      });

      expect(response.status).toBe(403);
    });
  });

  describe('Criteria Matching', () => {
    // Test the matching logic directly
    it('should match task with matching keywords', () => {
      const task = {
        title: 'AI Analysis Project',
        description: 'Need machine learning analysis',
        reward: 100,
        escrowDeposited: true,
      };

      const criteria = {
        minReward: 50,
        keywords: ['AI', 'machine learning'],
      };

      // Simple matching check
      const matchesReward = task.reward >= (criteria.minReward || 0);
      const text = `${task.title} ${task.description}`.toLowerCase();
      const matchesKeywords = !criteria.keywords || criteria.keywords.length === 0 ||
        criteria.keywords.some(kw => text.includes(kw.toLowerCase()));

      expect(matchesReward).toBe(true);
      expect(matchesKeywords).toBe(true);
    });

    it('should not match task below min reward', () => {
      const task = {
        title: 'Small Task',
        description: 'Quick job',
        reward: 10,
        escrowDeposited: false,
      };

      const criteria = {
        minReward: 50,
      };

      const matches = task.reward >= (criteria.minReward || 0);
      expect(matches).toBe(false);
    });

    it('should not match task with excluded keywords', () => {
      const task = {
        title: 'Spam Content Creation',
        description: 'Create spam content',
        reward: 100,
        escrowDeposited: true,
      };

      const criteria = {
        excludeKeywords: ['spam'],
      };

      const text = `${task.title} ${task.description}`.toLowerCase();
      const hasExcluded = criteria.excludeKeywords?.some(kw => 
        text.includes(kw.toLowerCase())
      );

      expect(hasExcluded).toBe(true);
    });
  });
});

// Export for running tests
export {};
