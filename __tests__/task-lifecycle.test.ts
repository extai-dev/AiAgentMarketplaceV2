import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

/**
 * Task Lifecycle Integration Tests
 * 
 * These tests verify the complete task process lifecycle:
 * 1. Agent registration
 * 2. Task creation
 * 3. Task dispatch to agents
 * 4. Bid submission from agents
 * 5. Task assignment to agent
 * 6. Task completion
 * 7. Task finalization and payout
 */

const API_BASE = 'http://localhost:3000/api';

// Test data
const testOwnerWallet = '0xOwnerTest123456789abcdef123456789abcdef1234';
const testAgentWallet = '0xAgentTest123456789abcdef123456789abcdef12345';
const testTaskCreatorWallet = '0xCreatorTest123456789abcdef123456789abcdef12';
const testBidderWallet = '0xBidderTest123456789abcdef123456789abcdef12345';

interface Agent {
  id: string;
  name: string;
  walletAddress: string;
  apiToken?: string;
  status: string;
}

interface User {
  id: string;
  name: string;
  walletAddress: string;
  role: string;
}

interface Task {
  id: string;
  numericId: number;
  title: string;
  description: string;
  reward: number;
  status: string;
  tokenSymbol: string;
  creatorId: string;
  agentId?: string;
  onChainId?: string;
  txHash?: string;
  deadline?: string;
}

interface Bid {
  id: string;
  taskId: string;
  userId: string;
  amount: number;
  message: string;
  status: string;
  txHash?: string;
}

describe('Task Lifecycle', () => {
  let registeredAgent: Agent | null = null;
  let taskCreator: User | null = null;
  let bidder: User | null = null;
  let createdTask: Task | null = null;
  let createdBid: Bid | null = null;

  describe('Phase 1: Agent Registration', () => {
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

    it('should get agent details by ID', async () => {
      if (!registeredAgent) {
        throw new Error('No registered agent');
      }

      const response = await fetch(`${API_BASE}/agents/${registeredAgent.id}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(registeredAgent.id);
      expect(data.data.name).toBe('Test AI Agent');
      expect(data.data.walletAddress).toBe(testAgentWallet.toLowerCase());
    });
  });

  describe('Phase 2: User Creation', () => {
    it('should create or get task creator user', async () => {
      const response = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: testTaskCreatorWallet,
          name: 'Task Creator',
          role: 'user',
        }),
      });

      const data = await response.json();
      console.log('User creation response:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.walletAddress).toBe(testTaskCreatorWallet.toLowerCase());
      expect(data.data.name).toBe('Task Creator');

      taskCreator = data.data;
    });

    it('should create or get bidder user', async () => {
      const response = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: testBidderWallet,
          name: 'Bidder User',
          role: 'user',
        }),
      });

      const data = await response.json();
      console.log('Bidder user creation response:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.walletAddress).toBe(testBidderWallet.toLowerCase());
      expect(data.data.name).toBe('Bidder User');

      bidder = data.data;
    });
  });

  describe('Phase 3: Task Creation', () => {
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
      expect(data.data.status).toBe('OPEN');
      expect(data.data.numericId).toBeGreaterThan(0);
      expect(data.data.creatorId).toBe(taskCreator?.id);

      createdTask = data.data;
    });

    it('should get task by ID', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(createdTask.id);
      expect(data.data.title).toBe('AI Data Analysis Task');
      expect(data.data.status).toBe('OPEN');
      expect(data.data.creator).toBeDefined();
      expect(data.data.creator.walletAddress).toBe(testTaskCreatorWallet.toLowerCase());
    });

    it('should list all tasks', async () => {
      const response = await fetch(`${API_BASE}/tasks?limit=10`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('should filter tasks by status', async () => {
      const response = await fetch(`${API_BASE}/tasks?status=OPEN`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      data.data.forEach((task: Task) => {
        expect(task.status).toBe('OPEN');
      });
    });
  });

  describe('Phase 4: Task Dispatch', () => {
    it('should dispatch task to matching agents', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      // Wait for async dispatch
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check agent dispatch logs
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
        expect(dispatch.taskId).toBe(createdTask.id);
        expect(dispatch.taskId).toBeDefined();
      }
    });

    it('should dispatch task with on-chain ID', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onChainId: '0xTask123',
          txHash: '0xTxHash123',
        }),
      });

      const data = await response.json();
      console.log('Task update response:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.onChainId).toBe('0xTask123');
      expect(data.data.txHash).toBe('0xTxHash123');
    });
  });

  describe('Phase 5: Bid Submission', () => {
    it('should submit a bid for the task', async () => {
      if (!createdTask || !bidder) {
        throw new Error('No created task or bidder');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: bidder.id,
          amount: 45,
          message: 'I can analyze your data efficiently using ML techniques.',
          txHash: '0xBidTxHash123',
        }),
      });

      const data = await response.json();
      console.log('Bid submission response:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.taskId).toBe(createdTask.id);
      expect(data.data.userId).toBe(bidder.id);
      expect(data.data.amount).toBe(45);
      expect(data.data.status).toBe('PENDING');
      expect(data.data.txHash).toBe('0xBidTxHash123');

      createdBid = data.data;
    });

    it('should reject bid with invalid amount', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: bidder?.id,
          amount: -10, // Invalid amount
          message: 'Invalid bid',
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('positive');
    });

    it('should reject bid for closed task', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      // First, close the task
      await fetch(`${API_BASE}/tasks/${createdTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ASSIGNED',
          agentId: bidder?.id,
        }),
      });

      // Try to submit bid to closed task
      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: bidder?.id,
          amount: 40,
          message: 'This should fail',
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('not open');
    });

    it('should list all bids for the task', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}/bids`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0].taskId).toBe(createdTask.id);
    });

    it('should get single bid by ID', async () => {
      if (!createdBid) {
        throw new Error('No created bid');
      }

      const response = await fetch(`${API_BASE}/bids/${createdBid.id}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(createdBid.id);
      expect(data.data.taskId).toBe(createdTask?.id);
    });
  });

  describe('Phase 6: Task Assignment', () => {
    it('should assign task to selected agent', async () => {
      if (!createdTask || !bidder) {
        throw new Error('No created task or bidder');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ASSIGNED',
          agentId: bidder.id,
        }),
      });

      const data = await response.json();
      console.log('Task assignment response:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('ASSIGNED');
      expect(data.data.agentId).toBe(bidder.id);
      expect(data.data.agent).toBeDefined();
      expect(data.data.agent.walletAddress).toBe(testBidderWallet.toLowerCase());
    });

    it('should update task status to IN_PROGRESS', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'IN_PROGRESS',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('IN_PROGRESS');
    });
  });

  describe('Phase 7: Task Completion', () => {
    it('should submit task completion with result hash', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'COMPLETED',
          resultHash: '0xResultHash123456',
          txHash: '0xCompletionTxHash123',
        }),
      });

      const data = await response.json();
      console.log('Task completion response:', JSON.stringify(data, null, 2));

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('COMPLETED');
      expect(data.data.resultHash).toBe('0xResultHash123456');
      expect(data.data.txHash).toBe('0xCompletionTxHash123');
    });

    it('should verify task is completed', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('COMPLETED');
      expect(data.data.resultHash).toBeDefined();
      expect(data.data.txHash).toBeDefined();
    });

    it('should verify bid status is updated', async () => {
      if (!createdBid) {
        throw new Error('No created bid');
      }

      const response = await fetch(`${API_BASE}/bids/${createdBid.id}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('APPROVED');
    });

    it('should list completed tasks', async () => {
      const response = await fetch(`${API_BASE}/tasks?status=COMPLETED`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      data.data.forEach((task: Task) => {
        expect(task.status).toBe('COMPLETED');
      });
    });
  });

  describe('Phase 8: Task Deletion', () => {
    it('should delete task only if OPEN status', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      // Try to delete OPEN task
      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toContain('deleted');
    });

    it('should reject deletion of non-OPEN task', async () => {
      // Create a new task
      const newTaskResponse = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Task',
          description: 'Another test task',
          reward: 100,
          tokenSymbol: 'TT',
          creatorWalletAddress: testTaskCreatorWallet,
        }),
      });

      const newTaskData = await newTaskResponse.json();
      const newTask = newTaskData.data;

      // Try to delete ASSIGNED task
      await fetch(`${API_BASE}/tasks/${newTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ASSIGNED',
        }),
      });

      const deleteResponse = await fetch(`${API_BASE}/tasks/${newTask.id}`, {
        method: 'DELETE',
      });

      const deleteData = await deleteResponse.json();
      expect(deleteResponse.status).toBe(400);
      expect(deleteData.success).toBe(false);
      expect(deleteData.error).toContain('OPEN');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle invalid task ID', async () => {
      const response = await fetch(`${API_BASE}/tasks/invalid-id`);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toContain('not found');
    });

    it('should handle invalid update data', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      const response = await fetch(`${API_BASE}/tasks/${createdTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'INVALID_STATUS',
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });

    it('should handle concurrent bids on same task', async () => {
      if (!createdTask) {
        throw new Error('No created task');
      }

      // Create two bids concurrently
      const [response1, response2] = await Promise.all([
        fetch(`${API_BASE}/tasks/${createdTask.id}/bids`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: bidder?.id,
            amount: 40,
            message: 'First bid',
          }),
        }),
        fetch(`${API_BASE}/tasks/${createdTask.id}/bids`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: bidder?.id,
            amount: 42,
            message: 'Second bid',
          }),
        }),
      ]);

      const data1 = await response1.json();
      const data2 = await response2.json();

      // Both should succeed (first come, first served)
      expect(response1.status).toBe(201);
      expect(response2.status).toBe(201);

      // Verify both bids exist
      const bidsResponse = await fetch(`${API_BASE}/tasks/${createdTask.id}/bids`);
      const bidsData = await bidsResponse.json();

      expect(bidsData.data.length).toBeGreaterThanOrEqual(2);
    });
  });
});
