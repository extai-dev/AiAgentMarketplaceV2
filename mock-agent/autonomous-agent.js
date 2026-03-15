/**
 * Autonomous AI Agent for AI Agent Marketplace
 * 
 * This agent can:
 * - Register with the marketplace
 * - Receive task notifications via webhook (push model)
 * - Poll for open tasks (pull model)
 * - Evaluate tasks based on configurable criteria
 * - Submit bids on matching tasks
 * - Complete tasks and submit work
 * - Send heartbeats to maintain active status
 */
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// ===== CONFIGURATION =====
const CONFIG = {
  PORT: process.env.PORT || 4000,
  MARKETPLACE_URL: process.env.MARKETPLACE_URL || 'http://localhost:3000',
  AGENT_NAME: process.env.AGENT_NAME || 'Autonomous Task Agent',
  AGENT_DESCRIPTION: process.env.AGENT_DESCRIPTION || 'AI agent for automated task completion',
  AGENT_WALLET: process.env.AGENT_WALLET_ADDRESS,
  OWNER_WALLET: process.env.OWNER_WALLET_ADDRESS,
  API_TOKEN: process.env.API_TOKEN,

  // Agent criteria for task matching
  CRITERIA: {
    minReward: parseInt(process.env.MIN_REWARD) || 0,
    maxReward: parseInt(process.env.MAX_REWARD) || 100000,
    keywords: process.env.KEYWORDS ? process.env.KEYWORDS.split(',').map(k => k.trim()) : [],
    categories: process.env.CATEGORIES ? process.env.CATEGORIES.split(',').map(c => c.trim()) : [],
    excludeKeywords: process.env.EXCLUDE_KEYWORDS ? process.env.EXCLUDE_KEYWORDS.split(',').map(k => k.trim()) : ['urgent', 'asap', 'immediate'],
    requireEscrow: process.env.REQUIRE_ESCROW === 'true',
  },
  
  // Polling interval (if using pull model)
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL) || 60000, // 60 seconds
  
  // Heartbeat interval
  HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL) || 20000, // 20 seconds
};

// Validate required configuration
if (!CONFIG.AGENT_WALLET) {
  console.error('ERROR: AGENT_WALLET_ADDRESS environment variable is required');
  process.exit(1);
}

if (!CONFIG.OWNER_WALLET) {
  console.error('ERROR: OWNER_WALLET_ADDRESS environment variable is required');
  process.exit(1);
}

// ===== STATE =====
let apiToken = null;
let agentId = null;
let agentStatus = 'OFFLINE';

// Track processed notifications to avoid duplicates
const processedNotifications = new Set();

// Task tracking - remember which tasks we're working on
const assignedTasks = new Map();

// ===== HELPER FUNCTIONS =====

/**
 * Make authenticated API request to marketplace
 */
async function marketplaceApi(method, endpoint, data = null) {
  if (!apiToken || !agentId) {
    throw new Error('Agent not registered');
  }
  
  const config = {
    method,
    url: `${CONFIG.MARKETPLACE_URL}${endpoint}`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`,
      'X-Agent-ID': agentId,
    },
  };
  
  if (data) {
    config.data = data;
  }
  
  return axios(config);
}

/**
 * Evaluate if a task matches our criteria
 */
function evaluateTask(task) {
  const criteria = CONFIG.CRITERIA;
  const reasons = [];
  
  // Check reward range
  if (task.reward < criteria.minReward) {
    reasons.push(`Reward ${task.reward} below minimum ${criteria.minReward}`);
  }
  if (task.reward > criteria.maxReward) {
    reasons.push(`Reward ${task.reward} above maximum ${criteria.maxReward}`);
  }
  
  // Check escrow requirement
  if (criteria.requireEscrow && !task.escrowDeposited) {
    reasons.push('Escrow required but not deposited');
  }
  
  // Check keywords (at least one must match if specified)
  if (criteria.keywords && criteria.keywords.length > 0) {
    const text = `${task.title} ${task.description}`.toLowerCase();
    const hasKeyword = criteria.keywords.some(kw => 
      text.includes(kw.toLowerCase())
    );
    if (!hasKeyword) {
      reasons.push('No matching keywords');
    }
  }
  
  // Check exclude keywords
  if (criteria.excludeKeywords && criteria.excludeKeywords.length > 0) {
    const text = `${task.title} ${task.description}`.toLowerCase();
    const hasExcluded = criteria.excludeKeywords.some(kw => 
      text.includes(kw.toLowerCase())
    );
    if (hasExcluded) {
      reasons.push('Contains excluded keyword');
    }
  }
  
  if (reasons.length > 0) {
    return { shouldBid: false, reasons };
  }
  
  return { shouldBid: true, reasons: ['Matches all criteria'] };
}

/**
 * Calculate bid amount (simple strategy - full reward)
 */
function calculateBidAmount(task) {
  // Simple strategy: bid the full reward amount
  return task.reward;
}

/**
 * Simulate work completion (in a real agent, this would be AI processing)
 */
async function completeTask(task) {
  console.log(`Completing task ${task.id}...`);
  
  // Simulate work processing time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Generate a simple work result
  const workContent = `
# Task Completion Report

## Task Details
- ID: ${task.id}
- Title: ${task.title}
- Reward: ${task.reward} ${task.tokenSymbol}

## Work Performed
This task was completed by the autonomous agent.

### Description Analysis
${task.description.substring(0, 500)}

### Completion Status
- Status: COMPLETED
- Timestamp: ${new Date().toISOString()}
- Agent: ${CONFIG.AGENT_NAME}

## Notes
This is an automated task completion generated by the autonomous agent.
The agent evaluated the task based on its criteria and determined it could complete the work.
  `.trim();
  
  return {
    content: workContent,
    resultUri: null,
    resultHash: null,
  };
}

// ===== AGENT REGISTRATION =====

async function registerAgent() {
  try {
    console.log('Registering agent with marketplace...');
    
    // First, get or create the owner user and get their ID
    console.log('Getting owner user ID...');
    const userResponse = await axios.post(`${CONFIG.MARKETPLACE_URL}/api/users`, {
      walletAddress: CONFIG.OWNER_WALLET,
      name: 'Agent Owner',
    });
    
    const ownerId = userResponse.data.data.id;
    console.log(`Owner user ID: ${ownerId}`);
    
    // Check if agent already exists by querying all agents and matching wallet address
    console.log('Checking for existing agent...');
    try {
      const existingAgentsResponse = await axios.get(
        `${CONFIG.MARKETPLACE_URL}/api/agents`
      );
      
      console.log('Existing agents response:', JSON.stringify(existingAgentsResponse.data, null, 2));
      
      if (existingAgentsResponse.data.success && existingAgentsResponse.data.data.length > 0) {
        // Find agent with matching wallet address
        const existingAgent = existingAgentsResponse.data.data.find(
          (a) => a.walletAddress.toLowerCase() === CONFIG.AGENT_WALLET.toLowerCase()
        );
        
        if (existingAgent) {
          console.log('=== Found Existing Agent ===');
          console.log(`Agent ID: ${existingAgent.id}`);
          console.log(`Wallet: ${existingAgent.walletAddress}`);
          console.log('Using existing agent credentials.');
          console.log('=====================================');
          
          // Use API token from environment if available
          apiToken = CONFIG.API_TOKEN || 'unknown';
          agentId = existingAgent.id;
          agentStatus = existingAgent.status;
          
          return true;
        }
      }
    } catch (err) {
      // Log errors when checking for existing agent
      console.log('Error checking existing agent:', err.message);
    }
    
    console.log('No existing agent found, proceeding with registration...');
    
    // Agent doesn't exist, register new one
    const response = await axios.post(`${CONFIG.MARKETPLACE_URL}/api/agents/register`, {
      name: CONFIG.AGENT_NAME,
      description: CONFIG.AGENT_DESCRIPTION,
      walletAddress: CONFIG.AGENT_WALLET,
      ownerId: ownerId,
      execUrl: `http://localhost:${CONFIG.PORT}/task`,
      criteria: CONFIG.CRITERIA,
    });
    
    const data = response.data.data;
    apiToken = data.apiToken;
    agentId = data.id;
    agentStatus = 'ACTIVE';
    
    console.log('=== Agent Registered Successfully ===');
    console.log(`Agent ID: ${agentId}`);
    console.log(`API Token: ${apiToken.substring(0, 20)}...`);
    console.log(`Wallet: ${CONFIG.AGENT_WALLET}`);
    console.log(`Criteria:`, CONFIG.CRITERIA);
    console.log('=====================================');
    
    return true;
  } catch (error) {
    if (error.response?.data?.error?.includes('already registered')) {
      console.warn('Agent already registered. Please set API_TOKEN and AGENT_ID manually.');
      console.warn('Or delete the existing agent and restart.');
    } else {
      console.error('Registration failed:', error.response?.data || error.message);
    }
    return false;
  }
}

// ===== TASK NOTIFICATION HANDLER (PUSH MODEL) =====

/**
 * Webhook endpoint for receiving task notifications
 */
app.post('/task', async (req, res) => {
  console.log('\n=== Received Task Notification ===');
  
  // Immediately acknowledge receipt
  res.json({ status: 'received', message: 'Notification acknowledged' });
  
  const { task, notificationId, agent: agentInfo, type } = req.body;
  
  if (!task || !task.id) {
    console.error('Invalid task payload received');
    return;
  }
  
  console.log(`Notification Type: ${type || 'NEW_TASK'}`);
  console.log(`Task ID: ${task.id}, Title: ${task.title}`);
  console.log(`Reward: ${task.reward} ${task.tokenSymbol}`);
  
  // Check for duplicate notification
  if (processedNotifications.has(notificationId)) {
    console.log(`Notification ${notificationId} already processed, skipping...`);
    return;
  }
  processedNotifications.add(notificationId);
  
  // Clean up old notifications after 1 hour
  setTimeout(() => processedNotifications.delete(notificationId), 60 * 60 * 1000);
  
  // Handle different notification types
  if (type === 'TASK_CANCELLED') {
    console.log(`Task ${task.id} was cancelled`);
    return;
  }
  
  if (type === 'TASK_UPDATED') {
    console.log(`Task ${task.id} was updated`);
    return;
  }
  
  // Evaluate task
  const evaluation = evaluateTask(task);
  
  if (!evaluation.shouldBid) {
    console.log('Task does not match criteria:', evaluation.reasons);
    
    // Submit skip decision
    try {
      await marketplaceApi('POST', '/api/agents/callback', {
        type: 'BID_RESPONSE',
        taskId: task.id,
        decision: 'skip',
        reason: evaluation.reasons.join('; '),
        notificationId,
      });
      console.log('Skip decision submitted');
    } catch (error) {
      console.error('Failed to submit skip decision:', error.message);
    }
    return;
  }
  
  // Submit bid
  const bidAmount = calculateBidAmount(task);
  
  try {
    const response = await marketplaceApi('POST', '/api/agents/callback', {
      type: 'BID_RESPONSE',
      taskId: task.id,
      decision: 'bid',
      amount: bidAmount,
      message: `I can complete this task for ${bidAmount} ${task.tokenSymbol}.`,
      notificationId,
    });
    
    console.log(`Bid submitted for task ${task.id}:`, response.data.message);
    
    // Track that we submitted a bid
    console.log(`Waiting for task creator to accept bid...`);
  } catch (error) {
    console.error('Failed to submit bid:', error.response?.data || error.message);
  }
});

// ===== TASK POLLING (PULL MODEL) =====

/**
 * Poll for open tasks
 */
async function pollForTasks() {
  if (!apiToken || !agentId) {
    console.log('Agent not registered, skipping poll');
    return;
  }
  
  try {
    console.log('Polling for open tasks...');
    
    const response = await axios.get(
      `${CONFIG.MARKETPLACE_URL}/api/tasks/open?minReward=${CONFIG.CRITERIA.minReward}&maxReward=${CONFIG.CRITERIA.maxReward}&limit=20`,
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'X-Agent-ID': agentId,
        },
      }
    );
    
    const tasks = response.data.data || [];
    
    if (tasks.length === 0) {
      console.log('No open tasks found');
      return;
    }
    
    console.log(`Found ${tasks.length} open tasks`);
    
    for (const task of tasks) {
      // Evaluate task
      const evaluation = evaluateTask(task);
      
      if (!evaluation.shouldBid) {
        console.log(`Task ${task.id} does not match criteria:`, evaluation.reasons);
        continue;
      }
      
      // Submit bid
      const bidAmount = calculateBidAmount(task);
      
      try {
        await marketplaceApi('POST', `/api/tasks/${task.id}/bids`, {
          agentId: agentId,
          agentWalletAddress: CONFIG.AGENT_WALLET,
          amount: bidAmount,
          message: `I can complete this task for ${bidAmount} ${task.tokenSymbol}.`,
        });
        
        console.log(`Bid submitted via polling for task ${task.id}`);
      } catch (error) {
        if (error.response?.status === 400 && error.response?.data?.error?.includes('already')) {
          console.log(`Already bid on task ${task.id}`);
        } else {
          console.error(`Failed to bid on task ${task.id}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error('Polling failed:', error.response?.data || error.message);
  }
}

// ===== BID STATUS CHECKING =====

/**
 * Check status of our bids and handle accepted ones
 */
async function checkBidStatuses() {
  if (!apiToken || !agentId) return;
  
  try {
    // Get agent info to see assigned tasks
    const response = await axios.get(
      `${CONFIG.MARKETPLACE_URL}/api/agents/${agentId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'X-Agent-ID': agentId,
        },
      }
    );
    
    // Note: In a real implementation, we'd need to query for tasks where this agent is the selected bidder
    // For now, we'll check via the tasks API
  } catch (error) {
    // Silently handle - agent might not have any bids yet
  }
}

// ===== TASK COMPLETION =====

/**
 * Submit completed work for a task
 */
async function submitWork(taskId, workResult) {
  try {
    const response = await marketplaceApi('POST', `/api/tasks/${taskId}/submit`, {
      agentId: agentId,
      agentWalletAddress: CONFIG.AGENT_WALLET,
      content: workResult.content,
      resultUri: workResult.resultUri,
      resultHash: workResult.resultHash,
    });
    
    console.log(`Work submitted for task ${taskId}:`, response.data.message);
    return response.data;
  } catch (error) {
    console.error(`Failed to submit work for task ${taskId}:`, error.response?.data || error.message);
    throw error;
  }
}

// ===== HEARTBEAT =====

async function sendHeartbeat() {
  if (!apiToken || !agentId) return;
  
  try {
    const response = await marketplaceApi('POST', '/api/agents/callback', {
      type: 'HEARTBEAT',
      metrics: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        assignedTasks: assignedTasks.size,
        timestamp: new Date().toISOString(),
      },
    });
    
    console.log('Heartbeat sent:', response.data.message);
  } catch (error) {
    console.error('Heartbeat failed:', error.response?.data || error.message);
  }
}

// ===== STATUS ENDPOINTS =====

app.get('/status', (req, res) => {
  res.json({
    agentId,
    name: CONFIG.AGENT_NAME,
    wallet: CONFIG.AGENT_WALLET,
    status: agentStatus,
    registered: !!agentId,
    uptime: process.uptime(),
    criteria: CONFIG.CRITERIA,
    assignedTasks: assignedTasks.size,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: agentStatus,
    message: 'Autonomous Agent is running',
    agentId,
    name: CONFIG.AGENT_NAME,
    marketplace: CONFIG.MARKETPLACE_URL,
  });
});

// ===== START SERVER =====

app.listen(CONFIG.PORT, async () => {
  console.log(`\n🚀 Autonomous Agent starting on port ${CONFIG.PORT}`);
  console.log(`   Marketplace: ${CONFIG.MARKETPLACE_URL}`);
  console.log(`   Agent Name: ${CONFIG.AGENT_NAME}`);
  console.log(`   Wallet: ${CONFIG.AGENT_WALLET}\n`);
  
  // Register agent
  await registerAgent();
  
  // Start heartbeat
  setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL);
  
  // Start polling (if enabled)
  if (process.env.ENABLE_POLLING === 'true') {
    console.log(`Polling enabled (interval: ${CONFIG.POLL_INTERVAL}ms)`);
    setInterval(pollForTasks, CONFIG.POLL_INTERVAL);
  }
  
  // Periodic bid status check
  setInterval(checkBidStatuses, 30000);
});
