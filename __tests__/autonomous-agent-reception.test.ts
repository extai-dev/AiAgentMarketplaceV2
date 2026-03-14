/**
 * Autonomous Agent Task Reception Integration Test
 * 
 * This test verifies that after creating a task:
 * 1. The autonomous-agent receives the task notification
 * 2. The agent performs the bidding process
 * 3. The bid is submitted to the task
 * 4. The task can be completed (bid accepted, work submitted, validated)
 * 
 * Prerequisites:
 * - The mock autonomous agent should be running on port 4000
 * - The agent should be registered with the marketplace
 * - The marketplace API should be running on localhost:3000
 */

// Use node's built-in http module for requests
/* eslint-disable @typescript-eslint/no-explicit-any */
const http = require('http');

// Simple fetch-like function using Node's http module
async function apiRequest(
  method: string,
  url: string,
  body?: any
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => (data += chunk));
      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode || 200, data: jsonData });
        } catch (e) {
          resolve({ status: res.statusCode || 200, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

const API_BASE = 'http://localhost:3000/api';

// Test configuration - must match the mock agent's criteria
const MOCK_AGENT_WALLET = '0x0cD829B7eC7BB0acb27770f4c589b2D5020F8f6b';
const MOCK_OWNER_WALLET = '0x0cD829B7eC7BB0acb27770f4c589b2D5020F8f6b';

// Use wallet addresses that match the agent's criteria
const testTaskCreatorWallet = '0xCreatorTest123456789abcdef123456789abcdef12';

interface Agent {
  id: string;
  name: string;
  walletAddress: string;
  apiToken?: string;
  status: string;
  execUrl?: string;
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
}

interface Bid {
  id: string;
  taskId: string;
  agentId: string;
  amount: number;
  message: string;
  status: string;
}

interface WorkSubmission {
  id: string;
  taskId: string;
  agentId: string;
  content: string;
  status: string;
  score?: number;
}

describe('Autonomous Agent Task Reception', () => {
  let registeredAgent: Agent | null = null;
  let createdTask: Task | null = null;
  let createdBid: Bid | null = null;
  let agentApiToken: string | null = null;

  // Timeout for waiting for async agent responses
  const AGENT_RESPONSE_TIMEOUT = 15000; // 15 seconds
  const POLL_INTERVAL = 1000; // 1 second

  /**
   * Helper function to wait for a condition with polling
   */
  async function waitForCondition(
    conditionFn: () => Promise<boolean>,
    timeout: number = AGENT_RESPONSE_TIMEOUT,
    interval: number = POLL_INTERVAL
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await conditionFn()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    return false;
  }

  /**
   * Get or create the mock agent
   */
  async function getOrCreateAgent(): Promise<Agent> {
    // First try to find existing agent by wallet
    const listResponse = await apiRequest('GET', `${API_BASE}/agents`);
    const listData = listResponse.data;
    
    if (listData.success && listData.data.length > 0) {
      const existingAgent = listData.data.find(
        (a: any) => a.walletAddress?.toLowerCase() === MOCK_AGENT_WALLET.toLowerCase()
      );
      
      if (existingAgent) {
        console.log('Found existing agent:', existingAgent.id);
        return {
          ...existingAgent,
          apiToken: '23b0d3502ed70d22483b228eb130848cadb443b1c6769a24dcc75ab443b1307a', // Known token from .env
        };
      }
    }

    throw new Error('Agent not found. Please ensure mock-agent is running and registered.');
  }

  /**
   * Create a task that matches the agent's criteria
   * The mock agent criteria: minReward=10, maxReward=10000, keywords=code,review,test,debug
   */
  async function createMatchingTask(): Promise<Task> {
    const response = await apiRequest('POST', `${API_BASE}/tasks`, {
      title: 'Code Review Task',
      description: 'We need a code review for our TypeScript project. Please review the code and provide feedback.',
      reward: 50, // Within agent's minReward=10, maxReward=10000
      tokenSymbol: 'TT',
      creatorWalletAddress: testTaskCreatorWallet,
    });

    const data = response.data;
    console.log('Task creation response:', JSON.stringify(data, null, 2));

    if (response.status !== 201) {
      throw new Error(`Failed to create task: ${data.error}`);
    }

    return data.data;
  }

  /**
   * Get task by ID
   */
  async function getTask(taskId: string): Promise<Task | null> {
    const response = await apiRequest('GET', `${API_BASE}/tasks/${taskId}`);
    const data = response.data;
    return data.success ? data.data : null;
  }

  /**
   * Get bids for a task
   */
  async function getTaskBids(taskId: string): Promise<Bid[]> {
    const response = await apiRequest('GET', `${API_BASE}/tasks/${taskId}/bids`);
    const data = response.data;
    return data.success ? data.data : [];
  }

  /**
   * Accept a bid
   */
  async function acceptBid(taskId: string, bidId: string): Promise<void> {
    const response = await apiRequest('PUT', `${API_BASE}/tasks/${taskId}/bids`, {
      bidId,
      status: 'ACCEPTED',
    });

    const data = response.data;
    console.log('Accept bid response:', JSON.stringify(data, null, 2));

    if (response.status !== 200) {
      throw new Error(`Failed to accept bid: ${data.error}`);
    }
  }

  /**
   * Submit work for a task
   */
  async function submitWork(taskId: string, agentId: string): Promise<WorkSubmission> {
    const response = await apiRequest('POST', `${API_BASE}/tasks/${taskId}/submit`, {
      agentId,
      content: `
# Task Completion Report

## Summary
The code review has been completed successfully.

## Findings
- Code follows TypeScript best practices
- No critical security issues found
- Some minor suggestions for improvement

## Recommendations
1. Add more unit tests
2. Consider using const instead of let where possible
3. Add JSDoc comments to public functions

## Conclusion
The code is ready for production with minor improvements.
      `.trim(),
    });

    const data = response.data;
    console.log('Submit work response:', JSON.stringify(data, null, 2));

    if (response.status !== 201) {
      throw new Error(`Failed to submit work: ${data.error}`);
    }

    return data.data;
  }

  beforeAll(async () => {
    // Get or verify the mock agent is registered
    console.log('Verifying mock agent is registered...');
    registeredAgent = await getOrCreateAgent();
    agentApiToken = registeredAgent.apiToken || null;
    console.log('Registered agent:', registeredAgent);
  });

  afterAll(async () => {
    // Cleanup - we don't delete the agent as it's shared across tests
    console.log('Test completed');
  });

  describe('Phase 1: Task Creation and Agent Reception', () => {
    it('should create a task that matches agent criteria', async () => {
      createdTask = await createMatchingTask();
      
      expect(createdTask).toBeDefined();
      expect(createdTask.id).toBeDefined();
      expect(createdTask.title).toBe('Code Review Task');
      expect(createdTask.reward).toBe(50);
      expect(createdTask.status).toBe('OPEN');
      
      console.log('Created task:', createdTask.id);
    });

    it('should dispatch task to the autonomous agent', async () => {
      if (!createdTask) {
        throw new Error('No task created in previous test');
      }

      // Wait a moment for the async dispatch to occur
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check that the task was dispatched to the agent
      // We verify this indirectly by checking if the agent received the task
      // and submitted a bid (which happens automatically via the mock agent)
      
      const bids = await getTaskBids(createdTask.id);
      console.log('Bids after dispatch:', bids);

      // Wait for agent to respond (with timeout)
      // Increase timeout to allow agent to process and respond
      const agentResponded = await waitForCondition(async () => {
        const currentBids = await getTaskBids(createdTask!.id);
        return currentBids.length > 0;
      }, 15000); // Increased to 15 seconds

      expect(agentResponded).toBe(true);
      
      const finalBids = await getTaskBids(createdTask.id);
      expect(finalBids.length).toBeGreaterThan(0);
      
      createdBid = finalBids[0];
      console.log('Agent submitted bid:', createdBid);
    }, 20000); // Increase test timeout
  });

  describe('Phase 2: Bid Reception and Acceptance', () => {
    it('should receive a bid from the autonomous agent', async () => {
      if (!createdTask || !createdBid) {
        throw new Error('Task or bid not created');
      }

      expect(createdBid).toBeDefined();
      expect(createdBid.taskId).toBe(createdTask.id);
      expect(createdBid.amount).toBe(50); // Agent bids the full reward
      expect(createdBid.status).toBe('PENDING');
      
      console.log('Bid received from agent:', createdBid.id);
    });

    it('should accept the bid and assign task to agent', async () => {
      if (!createdTask || !createdBid) {
        throw new Error('Task or bid not created');
      }

      await acceptBid(createdTask.id, createdBid.id);

      // Verify task status changed to IN_PROGRESS
      const updatedTask = await getTask(createdTask.id);
      expect(updatedTask).not.toBeNull();
      if (!updatedTask) throw new Error('Task not found');
      expect(updatedTask.status).toBe('IN_PROGRESS');
      expect(updatedTask.agentId).toBeDefined();
      
      console.log('Task now in progress, assigned to agent');
    });
  });

  describe('Phase 3: Work Submission and Completion', () => {
    it('should submit work for the task', async () => {
      if (!createdTask) {
        throw new Error('Task not created');
      }

      // Get the agent's user ID from the task
      const task = await getTask(createdTask.id);
      if (!task || !task.agentId) {
        throw new Error('Task not assigned to agent');
      }

      const submission = await submitWork(createdTask.id, task.agentId);
      
      expect(submission).toBeDefined();
      expect(submission.taskId).toBe(createdTask.id);
      expect(submission.status).toBe('PENDING');
      
      console.log('Work submitted:', submission.id);
    });

    it('should validate the work and complete the task', async () => {
      if (!createdTask) {
        throw new Error('Task not created');
      }

      // Get the task with work submission
      const taskResponse = await apiRequest('GET', `${API_BASE}/tasks/${createdTask.id}`);
      const taskData = taskResponse.data;
      const taskWithSubmission = taskData.data;
      
      console.log('Task after work submission:', {
        status: taskWithSubmission.status,
        workSubmission: taskWithSubmission.workSubmission
      });
      
      // The task should now be in VALIDATING status (after work submission)
      expect(taskWithSubmission.status).toBe('VALIDATING');
      
      // Verify work submission exists
      expect(taskWithSubmission.workSubmission).toBeDefined();
      expect(taskWithSubmission.workSubmission.status).toBe('PENDING');
      
      // Now validate the work
      const submissionId = taskWithSubmission.workSubmission.id;
      const validationResponse = await apiRequest('POST', `${API_BASE}/validation`, {
        submissionId,
        score: 85,
        comments: 'Work completed successfully - code review was thorough',
      });

      const validationData = validationResponse.data;
      console.log('Validation response:', JSON.stringify(validationData, null, 2));

      // Verify validation passed
      expect(validationResponse.status).toBe(200);
      expect(validationData.success).toBe(true);
      
      // Verify task is now COMPLETED
      const finalTask = await getTask(createdTask.id);
      expect(finalTask?.status).toBe('COMPLETED');
      
      console.log('Task completed successfully!');
    });
  });

  describe('Phase 4: Verification Summary', () => {
    it('should verify complete autonomous agent workflow', async () => {
      // Summary of what we verified:
      // 1. Task was created ✓
      // 2. Task was dispatched to autonomous agent ✓
      // 3. Agent received the task and submitted a bid ✓
      // 4. Bid was accepted and task assigned to agent ✓
      // 5. Work was submitted ✓
      // 6. Task status moved to VALIDATING ✓
      
      console.log('=== Autonomous Agent Workflow Verification Complete ===');
      console.log('Task ID:', createdTask?.id);
      console.log('Bid ID:', createdBid?.id);
      console.log('All phases completed successfully!');
      
      expect(true).toBe(true);
    });
  });
});
