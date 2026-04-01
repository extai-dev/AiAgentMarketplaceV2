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
 * 
 * LLM-Powered Features:
 * - Intelligent task evaluation with Gemini/OpenAI/Anthropic
 * - Smart bid amount calculation
 * - AI-driven task execution
 */
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import axios from "axios";

// ===== CLI ARG PARSING =====
// Support: node autonomous-agent.js --agent-id <id>
// Or:      AGENT_ID=<id> node autonomous-agent.js
function parseCliArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent-id" && args[i + 1]) {
      result.agentId = args[i + 1];
      i++;
    } else if (args[i].startsWith("--agent-id=")) {
      result.agentId = args[i].split("=")[1];
    } else if (args[i] === "--api-token" && args[i + 1]) {
      result.apiToken = args[i + 1];
      i++;
    } else if (args[i].startsWith("--api-token=")) {
      result.apiToken = args[i].split("=")[1];
    } else if (args[i] === "--port" && args[i + 1]) {
      result.port = parseInt(args[i + 1]);
      i++;
    } else if (args[i].startsWith("--port=")) {
      result.port = parseInt(args[i].split("=")[1]);
    } else if (!args[i].startsWith("-") && !result.agentId) {
      // Bare positional argument — treat as the agent ID
      // Usage: node autonomous-agent.js <agent-id>
      result.agentId = args[i];
    }
  }
  return result;
}

const CLI_ARGS = parseCliArgs();
const LOAD_AGENT_ID = CLI_ARGS.agentId || process.env.AGENT_ID || null;
const CLI_API_TOKEN = CLI_ARGS.apiToken || null;
const CLI_PORT = CLI_ARGS.port || null;
import {
  initializeLLM,
  isLLMAvailable,
  generate,
  evaluateTaskWithLLM,
  calculateBidAmountWithLLM,
  executeTaskWithLLM,
  generateBidMessageWithLLM
} from "./lib/llm.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== CONFIGURATION =====
const CONFIG = {
  PORT: CLI_PORT || process.env.PORT || 4000,
  MARKETPLACE_URL: process.env.MARKETPLACE_URL || "http://localhost:3000",
  AGENT_NAME: process.env.AGENT_NAME || "Autonomous Task Agent",
  AGENT_DESCRIPTION:
    process.env.AGENT_DESCRIPTION || "AI agent for automated task completion",
  AGENT_WALLET: process.env.AGENT_WALLET_ADDRESS,
  OWNER_WALLET: process.env.OWNER_WALLET_ADDRESS,
  API_TOKEN: CLI_API_TOKEN || process.env.API_TOKEN,

  // Enable LLM-powered decision making
  USE_LLM: process.env.USE_LLM === "true",
  
  // Agent criteria for task matching (fallback if LLM fails)
  CRITERIA: {
    minReward: parseInt(process.env.MIN_REWARD) || 0,
    maxReward: parseInt(process.env.MAX_REWARD) || 100000,
    keywords: process.env.KEYWORDS
      ? process.env.KEYWORDS.split(",").map((k) => k.trim())
      : [],
    categories: process.env.CATEGORIES
      ? process.env.CATEGORIES.split(",").map((c) => c.trim())
      : [],
    excludeKeywords: process.env.EXCLUDE_KEYWORDS
      ? process.env.EXCLUDE_KEYWORDS.split(",").map((k) => k.trim())
      : ["urgent", "asap", "immediate"],
    requireEscrow: process.env.REQUIRE_ESCROW === "true",
  },

  // Polling interval (if using pull model)
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL) || 60000, // 60 seconds

  // Heartbeat interval
  HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL) || 20000, // 20 seconds
};

// Validate required configuration (skip wallet checks when loading agent from DB)
if (!LOAD_AGENT_ID) {
  if (!CONFIG.AGENT_WALLET) {
    console.error("ERROR: AGENT_WALLET_ADDRESS environment variable is required");
    process.exit(1);
  }
  if (!CONFIG.OWNER_WALLET) {
    console.error("ERROR: OWNER_WALLET_ADDRESS environment variable is required");
    process.exit(1);
  }
}

// ===== LOAD AGENT FROM DB =====

/**
 * Fetch an agent record from the marketplace DB and override CONFIG with its values.
 * Called at startup when --agent-id (or AGENT_ID env var) is provided.
 */
async function loadAgentFromDb(id) {
  console.log(`Loading agent config from DB for ID: ${id}`);
  const response = await axios.get(
    `${CONFIG.MARKETPLACE_URL}/api/agents/${id}`,
  );

  const agent = response.data?.data;
  if (!agent) {
    throw new Error(`Agent ${id} not found in DB`);
  }

  // Override CONFIG with values from DB
  CONFIG.AGENT_NAME = agent.name || CONFIG.AGENT_NAME;
  CONFIG.AGENT_DESCRIPTION = agent.description || CONFIG.AGENT_DESCRIPTION;
  CONFIG.AGENT_WALLET = agent.walletAddress || CONFIG.AGENT_WALLET;

  if (agent.criteria && typeof agent.criteria === "object") {
    CONFIG.CRITERIA = {
      ...CONFIG.CRITERIA,
      ...agent.criteria,
    };
  }

  console.log(`=== Loaded Agent from DB ===`);
  console.log(`  Name:   ${CONFIG.AGENT_NAME}`);
  console.log(`  Wallet: ${CONFIG.AGENT_WALLET}`);
  console.log(`  Status: ${agent.status}`);
  console.log(`===========================`);

  return agent;
}

// ===== STATE =====
let apiToken = null;
let agentId = null;
let agentStatus = "OFFLINE";
let ownerUserId = null;

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
    throw new Error("Agent not registered");
  }

  // console.log(apiToken ? `Using API token: ${apiToken.substring(0, 20)}...` : "No API token");

  const config = {
    method,
    url: `${CONFIG.MARKETPLACE_URL}${endpoint}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
      "X-Agent-ID": agentId,
    },
  };

  if (data) {
    config.data = data;
  }

  return axios(config);
}

/**
 * Evaluate if a task matches our criteria
 * Now LLM-powered for intelligent decision making
 */
async function evaluateTask(task) {
  // First do basic criteria check
  const criteria = CONFIG.CRITERIA;
  const basicReasons = [];

  // Check reward range
  if (task.reward < criteria.minReward) {
    basicReasons.push(`Reward ${task.reward} below minimum ${criteria.minReward}`);
  }
  if (task.reward > criteria.maxReward) {
    basicReasons.push(`Reward ${task.reward} above maximum ${criteria.maxReward}`);
  }

  // Check escrow requirement
  if (criteria.requireEscrow && !task.escrowDeposited) {
    basicReasons.push("Escrow required but not deposited");
  }

  // Check keywords (at least one must match if specified)
  if (criteria.keywords && criteria.keywords.length > 0) {
    const text = `${task.title} ${task.description}`.toLowerCase();
    const hasKeyword = criteria.keywords.some((kw) =>
      text.includes(kw.toLowerCase()),
    );
    if (!hasKeyword) {
      console.log(`Task ${task.id} does not match keywords: ${criteria.keywords.join(', ')}`);
      basicReasons.push("No matching keywords");
    }
  }

  // Check exclude keywords
  if (criteria.excludeKeywords && criteria.excludeKeywords.length > 0) {
    const text = `${task.title} ${task.description}`.toLowerCase();
    const hasExcluded = criteria.excludeKeywords.some((kw) =>
      text.includes(kw.toLowerCase()),
    );
    if (hasExcluded) {
      basicReasons.push("Contains excluded keyword");
    }
  }

  // If basic check fails, return immediately
  if (basicReasons.length > 0) {
    return { shouldBid: false, reasons: basicReasons, source: "criteria" };
  }

  // If LLM is enabled and available, use it for deeper analysis
  if (CONFIG.USE_LLM && isLLMAvailable()) {
    try {
      console.log(`[LLM] Evaluating task ${task.id} with LLM...`);
      const llmEvaluation = await evaluateTaskWithLLM(task);
      
      console.log(`[LLM] Evaluation result:`, JSON.stringify(llmEvaluation, null, 2));
      
      return {
        shouldBid: llmEvaluation.shouldBid,
        reasons: [llmEvaluation.reason],
        confidence: llmEvaluation.confidence,
        complexity: llmEvaluation.estimatedComplexity,
        risks: llmEvaluation.risks,
        requiredSkills: llmEvaluation.requiredSkills,
        source: "llm"
      };
    } catch (error) {
      console.error("[LLM] Evaluation failed, falling back to criteria:", error.message);
      // Fall through to criteria-based decision
    }
  }

  return { shouldBid: true, reasons: ["Matches all criteria"], source: "criteria" };
}

/**
 * Calculate bid amount - now LLM-powered for optimal pricing
 */
async function calculateBidAmount(task, evaluation = {}) {
  // If LLM is enabled, use it for smart bidding
  if (CONFIG.USE_LLM && isLLMAvailable()) {
    try {
      console.log(`[LLM] Calculating bid amount for task ${task.id}...`);
      const bidInfo = await calculateBidAmountWithLLM(task, evaluation);
      
      console.log(`[LLM] Bid calculation result:`, JSON.stringify(bidInfo, null, 2));
      
      return {
        amount: bidInfo.bidAmount,
        reasoning: bidInfo.reasoning,
        strategy: bidInfo.strategy,
        source: "llm"
      };
    } catch (error) {
      console.error("[LLM] Bid calculation failed:", error.message);
      // Fall through to default
    }
  }
  
  // Default: bid the full reward amount
  return {
    amount: task.reward,
    reasoning: "Default strategy: full reward",
    strategy: "balanced",
    source: "default"
  };
}

/**
 * Complete a task - now LLM-powered for real execution
 */
async function completeTask(task) {
  console.log(`Completing task ${task.id}...`);

  // If LLM is enabled, use it for real task execution
  if (CONFIG.USE_LLM && isLLMAvailable()) {
    try {
      console.log(`[LLM] Executing task ${task.id} with LLM...`);
      const result = await executeTaskWithLLM(task);
      
      console.log(`[LLM] Task execution ${result.success ? 'succeeded' : 'failed'}`);
      
      return {
        content: result.content,
        resultUri: result.resultUri,
        resultHash: result.resultHash,
        success: result.success
      };
    } catch (error) {
      console.error("[LLM] Task execution failed:", error.message);
      // Fall through to mock completion
    }
  }

  // Mock completion for backwards compatibility
  console.log(`Using mock task completion...`);

  // Simulate work processing time
  await new Promise((resolve) => setTimeout(resolve, 1000));

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
    success: true
  };
}

// ===== AGENT REGISTRATION =====

async function registerAgent() {
  try {
    // If started with --agent-id, load config from DB and skip full registration
    if (LOAD_AGENT_ID) {
      const agent = await loadAgentFromDb(LOAD_AGENT_ID);
      agentId = agent.id;
      agentStatus = agent.status;
      apiToken = CONFIG.API_TOKEN;

      if (!apiToken) {
        console.error("ERROR: API_TOKEN env var is required when using --agent-id");
        process.exit(1);
      }

      // Get the owner user ID from the agent record if available
      ownerUserId = agent.ownerId || null;

      // Warn if another agent is already registered at the same execUrl — they would
      // silently drop each other's task notifications (the /task handler checks agentId).
      const myExecUrl = `http://localhost:${CONFIG.PORT}/task`;
      try {
        const allAgents = await axios.get(`${CONFIG.MARKETPLACE_URL}/api/agents`);
        const conflict = (allAgents.data?.data || []).find(
          (a) => a.execUrl === myExecUrl && a.id !== agentId && a.status === "ACTIVE"
        );
        if (conflict) {
          console.warn(`\n⚠️  PORT CONFLICT DETECTED!`);
          console.warn(`   Agent "${conflict.name}" (${conflict.id}) is already using ${myExecUrl}.`);
          console.warn(`   Each agent must run on a unique port or task notifications will be dropped.`);
          console.warn(`   Start with a different port: node autonomous-agent.js --agent-id ${agentId} --port 4001\n`);
        }
      } catch (_) { /* non-fatal */ }

      // Sync execUrl so dispatch works on the current port
      try {
        await axios.put(`${CONFIG.MARKETPLACE_URL}/api/agents/${agentId}`, {
          ownerId: ownerUserId,
          execUrl: myExecUrl,
        });
        console.log(`execUrl synced to ${myExecUrl}`);
      } catch (syncErr) {
        console.warn("Failed to sync execUrl (non-fatal):", syncErr.message);
      }

      return true;
    }

    console.log("Registering agent with marketplace...");

    // First, get or create the owner user and get their ID
    console.log("Getting owner user ID...");
    const userResponse = await axios.post(
      `${CONFIG.MARKETPLACE_URL}/api/users`,
      {
        walletAddress: CONFIG.OWNER_WALLET,
        name: "Agent Owner",
      },
    );

    const ownerId = userResponse.data.data.id;
    ownerUserId = ownerId;
    console.log(`Owner user ID: ${ownerId}`);

    // Check if agent already exists by querying all agents and matching wallet address
    console.log("Checking for existing agent...");
    try {
      const existingAgentsResponse = await axios.get(
        `${CONFIG.MARKETPLACE_URL}/api/agents`,
      );

      console.log(
        "Existing agents response:",
        JSON.stringify(existingAgentsResponse.data, null, 2),
      );

      if (
        existingAgentsResponse.data.success &&
        existingAgentsResponse.data.data.length > 0
      ) {
        // Find agent with matching wallet address
        const existingAgent = existingAgentsResponse.data.data.find(
          (a) =>
            a.walletAddress.toLowerCase() === CONFIG.AGENT_WALLET.toLowerCase(),
        );

        if (existingAgent) {
          console.log("=== Found Existing Agent ===");
          console.log(`Agent ID: ${existingAgent.id}`);
          console.log(`Owner user ID: ${ownerUserId}`);
          console.log(`Wallet: ${existingAgent.walletAddress}`);
          console.log(`apiTokenHash: ${existingAgent.apiTokenHash}`);
          console.log("Using existing agent credentials.");
          console.log("=====================================");

          // Use API token from environment if available
          apiToken = CONFIG.API_TOKEN || "unknown";
          agentId = existingAgent.id;
          agentStatus = existingAgent.status;

          // Sync current .env criteria and execUrl to DB so dispatch matching stays up-to-date
          try {
            await axios.put(
              `${CONFIG.MARKETPLACE_URL}/api/agents/${existingAgent.id}`,
              {
                ownerId: ownerId,
                criteria: CONFIG.CRITERIA,
                execUrl: `http://localhost:${CONFIG.PORT}/task`,
              },
            );
            console.log("Agent criteria and execUrl synced with .env values.");
          } catch (syncErr) {
            console.warn("Failed to sync agent criteria (non-fatal):", syncErr.message);
          }

          return true;
        }
      }
    } catch (err) {
      // Log errors when checking for existing agent
      console.log("Error checking existing agent:", err.message);
    }

    console.log("No existing agent found, proceeding with registration...");

    // Agent doesn't exist, register new one
    const response = await axios.post(
      `${CONFIG.MARKETPLACE_URL}/api/agents/register`,
      {
        name: CONFIG.AGENT_NAME,
        description: CONFIG.AGENT_DESCRIPTION,
        walletAddress: CONFIG.AGENT_WALLET,
        ownerId: ownerId,
        execUrl: `http://localhost:${CONFIG.PORT}/task`,
        criteria: CONFIG.CRITERIA,
      },
    );

    const data = response.data.data;
    apiToken = data.apiToken;
    agentId = data.id;
    agentStatus = "ACTIVE";

    console.log("=== Agent Registered Successfully ===");
    console.log(`Agent ID: ${agentId}`);
    console.log(`API Token: ${apiToken.substring(0, 20)}...`);
    console.log(`Wallet: ${CONFIG.AGENT_WALLET}`);
    console.log(`Criteria:`, CONFIG.CRITERIA);
    console.log(
      `apiToken: ${apiToken ? apiToken.substring(0, 20) + "..." : "No API token"}`,
    );
    console.log("=====================================");

    return true;
  } catch (error) {
    if (error.response?.data?.error?.includes("already registered")) {
      console.warn(
        "Agent already registered. Please set API_TOKEN and AGENT_ID manually.",
      );
      console.warn("Or delete the existing agent and restart.");
    } else {
      console.error(
        "Registration failed:",
        error.response?.data || error.message,
      );
    }
    return false;
  }
}

// ===== TASK NOTIFICATION HANDLER (PUSH MODEL) =====

/**
 * Webhook endpoint for receiving task notifications
 */
app.post("/task", async (req, res) => {
  // Log EVERYTHING immediately
  console.log("\n=== 🔥 TASK ENDPOINT HIT ===");
  console.log("Time:", new Date().toISOString());
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log("============================\n");

  // Immediately acknowledge receipt
  res.json({ status: "received", message: "Notification acknowledged" });

  const { task, notificationId, agent: agentInfo, type } = req.body;

  if (!task || !task.id) {
    console.error("Invalid task payload received");
    return;
  }

  console.log(`Notification Type: ${type || "NEW_TASK"}`);
  console.log(`Task ID: ${task.id}, Title: ${task.title}`);
  console.log(`Reward: ${task.reward} ${task.tokenSymbol}`);

  // Only process notifications addressed to this agent
  if (agentInfo && agentInfo.id !== agentId) {
    console.log(`Notification for agent ${agentInfo.id} (not us: ${agentId}), skipping.`);
    return;
  }

  // Check for duplicate notification
  if (processedNotifications.has(notificationId)) {
    console.log(
      `Notification ${notificationId} already processed, skipping...`,
    );
    return;
  }
  processedNotifications.add(notificationId);

  // Clean up old notifications after 1 hour
  setTimeout(
    () => processedNotifications.delete(notificationId),
    60 * 60 * 1000,
  );

  // Handle different notification types
  if (type === "TASK_CANCELLED") {
    console.log(`Task ${task.id} was cancelled`);
    return;
  }

  if (type === "TASK_UPDATED") {
    console.log(`Task ${task.id} was updated`);
    return;
  }

  // Handle revision request — re-execute task with client feedback
  if (type === "REVISION_REQUESTED") {
    const { feedback, previousSubmissions } = req.body;

    console.log(`\n=== REVISION REQUESTED ===`);
    console.log(`Task: ${task.id} — ${task.title}`);
    console.log(`Feedback: ${feedback}`);
    console.log(`Previous submissions: ${previousSubmissions?.length ?? 0}`);
    console.log(`=========================\n`);

    try {
      let revisedContent;

      if (CONFIG.USE_LLM && isLLMAvailable()) {
        // Build structured revision prompt with full history
        const historyText = (previousSubmissions || [])
          .map(
            (s) =>
              `### Version ${s.version}\n${s.content}\n\n**Feedback:** ${s.feedback || "None"}`
          )
          .join("\n\n---\n\n");

        const revisionPrompt = `You are re-working a previously submitted task based on client feedback.

## Original Task
**Title:** ${task.title}
**Description:** ${task.description}

## Submission History
${historyText}

## Client Feedback on Latest Submission
${feedback}

## Instructions
Produce an improved version that fully addresses the client's feedback.
Reference the history to avoid repeating prior mistakes.
Return only the final deliverable content.`;

        revisedContent = await generate(revisionPrompt, { maxTokens: 4000 });
      } else {
        // Mock revision: acknowledge feedback and build on previous content
        const lastSubmission = (previousSubmissions || []).slice(-1)[0];
        revisedContent = `# Revised Submission (Addressing Feedback)

## Client Feedback
${feedback}

## Previous Work
${lastSubmission ? lastSubmission.content : "No previous submission found."}

## Revisions Made
- Reviewed and addressed client feedback
- Revised: ${new Date().toISOString()}
- Agent: ${CONFIG.AGENT_NAME}`.trim();
      }

      // Submit new version via /submissions endpoint
      const submitResponse = await marketplaceApi(
        "POST",
        `/api/tasks/${task.id}/submissions`,
        {
          agentId: agentId,
          agentWalletAddress: CONFIG.AGENT_WALLET,
          content: revisedContent,
        }
      );

      console.log(
        `Revised submission created! Version: ${submitResponse.data.data?.version}`
      );

      // Track as in-progress
      assignedTasks.set(task.id, {
        task,
        startedAt: new Date(),
        revision: true,
      });
    } catch (error) {
      console.error(
        `Failed to submit revision for task ${task.id}:`,
        error.response?.data || error.message
      );
    }
    return;
  }

  // Handle bid accepted - execute the task!
  if (type === "BID_ACCEPTED") {
    console.log(`\n=== BID ACCEPTED! ===`);
    console.log(`Task ${task.id} - ${task.title}`);
    console.log(`Reward: ${task.reward} ${task.tokenSymbol}`);
    console.log(`====================\n`);

    // Track the assigned task
    assignedTasks.set(task.id, {
      task,
      bid: req.body.bid,
      startedAt: new Date(),
    });

    // Execute the task and submit the work
    try {
      console.log(`Executing task ${task.id}...`);
      const result = await completeTask(task);

      console.log(`Task completed, submitting work as ${agentId}...`);
      const submitResponse = await marketplaceApi(
        "POST",
        `/api/tasks/${task.id}/submissions`,
        {
          agentId: agentId,
          agentWalletAddress: CONFIG.AGENT_WALLET,
          content: result.content,
        },
      );

      console.log(`Work submitted successfully!`, submitResponse.data.message);
      console.log(`Submission ID: ${submitResponse.data.data?.id}, Version: ${submitResponse.data.data?.version}`);

      // Remove from assigned tasks after successful completion
      assignedTasks.delete(task.id);
    } catch (error) {
      console.error(
        `Failed to execute/complete task ${task.id}:`,
        error.response?.data || error.message,
      );
      // Keep in assigned tasks for retry
    }
    return;
  }

  // Evaluate task (now async for LLM)
  const evaluation = await evaluateTask(task);

  if (!evaluation.shouldBid) {
    console.log("Task does not match criteria:", evaluation.reasons);

    // Submit skip decision
    try {
      await marketplaceApi("POST", "/api/agents/callback", {
        type: "BID_RESPONSE",
        taskId: task.id,
        decision: "skip",
        reason: evaluation.reasons.join("; "),
        notificationId,
      });
      console.log("Skip decision submitted");
    } catch (error) {
      console.error("Failed to submit skip decision:", error.message);
    }
    return;
  }

  // Calculate bid amount (now async for LLM)
  const bidInfo = await calculateBidAmount(task, evaluation);
  console.log(`Calculated bid: ${bidInfo.amount} (${bidInfo.strategy} strategy)`);

  // Generate bid message with LLM if available
  let bidMessage;
  if (CONFIG.USE_LLM && isLLMAvailable()) {
    try {
      bidMessage = await generateBidMessageWithLLM(task, evaluation, bidInfo);
    } catch (error) {
      console.error("[LLM] Bid message generation failed:", error.message);
      bidMessage = `I can complete this task for ${bidInfo.amount} ${task.tokenSymbol}.`;
    }
  } else {
    bidMessage = `I can complete this task for ${bidInfo.amount} ${task.tokenSymbol}.`;
  }

  try {
    console.log(
      `Submitting bid for task ${task.id} with amount ${bidInfo.amount}...`,
    );
    const response = await marketplaceApi("POST", "/api/agents/callback", {
      type: "BID_RESPONSE",
      taskId: task.id,
      agentId: agentId,
      decision: "bid",
      amount: bidInfo.amount,
      message: bidMessage,
      notificationId,
    });

    console.log(`Bid submitted for task ${task.id}:`, response.data.message);

    // Track that we submitted a bid
    console.log(`Waiting for task creator to accept bid...`);
  } catch (error) {
    console.error(
      "Failed to submit bid:",
      error.response?.data || error.message,
    );
  }
});

// ===== TASK POLLING (PULL MODEL) =====

/**
 * Poll for open tasks
 */
async function pollForTasks() {
  if (!apiToken || !agentId) {
    console.log("Agent not registered, skipping poll");
    return;
  }

  try {
    console.log("Polling for open tasks...");

    const response = await axios.get(
      `${CONFIG.MARKETPLACE_URL}/api/tasks/open?minReward=${CONFIG.CRITERIA.minReward}&maxReward=${CONFIG.CRITERIA.maxReward}&limit=20`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "X-Agent-ID": agentId,
        },
      },
    );

    const tasks = response.data.data || [];

    if (tasks.length === 0) {
      console.log("No open tasks found");
      return;
    }

    console.log(`Found ${tasks.length} open tasks`);

    for (const task of tasks) {
      // Evaluate task (now async for LLM)
      const evaluation = await evaluateTask(task);

      if (!evaluation.shouldBid) {
        console.log(
          `Task ${task.id} does not match criteria:`,
          evaluation.reasons,
        );
        continue;
      }

      // Calculate bid amount (now async for LLM)
      const bidInfo = await calculateBidAmount(task, evaluation);

      try {
        await marketplaceApi("POST", `/api/tasks/${task.id}/bids`, {
          agentId: agentId,
          agentWalletAddress: CONFIG.AGENT_WALLET,
          amount: bidInfo.amount,
          message: `I can complete this task for ${bidInfo.amount} ${task.tokenSymbol}.`,
        });

        console.log(`Bid submitted via polling for task ${task.id}`);
      } catch (error) {
        if (
          error.response?.status === 400 &&
          error.response?.data?.error?.includes("already")
        ) {
          console.log(`Already bid on task ${task.id}`);
        } else {
          console.error(`Failed to bid on task ${task.id}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error("Polling failed:", error.response?.data || error.message);
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
          Authorization: `Bearer ${apiToken}`,
          "X-Agent-ID": agentId,
        },
      },
    );

    // Note: In a real implementation, we'd need to query for tasks where this agent is the selected bidder
    // For now, we'll check via the tasks API
  } catch (error) {
    // Silently handle - agent might not have any bids yet
  }
}

// ===== BID ACCEPTANCE HANDLER =====

/**
 * Endpoint for marketplace to notify when a bid is accepted
 */
app.post("/bid-accepted", async (req, res) => {
  console.log("\n=== Bid Accepted Notification ===");

  // Immediately acknowledge
  res.json({ status: "received" });

  const { taskId, bidId, task, bid } = req.body;

  console.log(`Task ID: ${taskId}`);
  console.log(`Task Title: ${task?.title || "Unknown"}`);

  if (!taskId && !task) {
    console.error("No task information in bid acceptance");
    return;
  }

  // Store the task in assignedTasks
  const taskData = task || { id: taskId };
  assignedTasks.set(taskId, {
    ...taskData,
    status: "ASSIGNED",
    acceptedAt: new Date().toISOString(),
  });

  console.log(`Task ${taskId} assigned to agent. Starting work...`);

  // Complete the task
  try {
    const workResult = await completeTask(taskData);
    await submitWork(taskId, workResult);
    console.log(`Task ${taskId} completed and submitted successfully!`);
  } catch (error) {
    console.error(`Failed to complete task ${taskId}:`, error.message);
  }
});

// ===== CHECK FOR ACCEPTED BIDS =====

/**
 * Poll for tasks where our bid was accepted
 */
async function checkForAcceptedBids() {
  if (!apiToken || !agentId) return;

  try {
    // Get tasks where this agent is assigned and in progress (not yet completed)
    // Status should be IN_PROGRESS after bid is accepted
    const response = await axios.get(
      `${CONFIG.MARKETPLACE_URL}/api/tasks?agentId=${agentId}&status=IN_PROGRESS`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "X-Agent-ID": agentId,
        },
      },
    );

    const tasks = response.data.data || [];

    for (const task of tasks) {
      // Check if we're already working on this task
      if (assignedTasks.has(task.id)) {
        continue;
      }

      console.log(`\n=== Found assigned task via polling ===`);
      console.log(`Task ID: ${task.id}, Title: ${task.title}`);

      assignedTasks.set(task.id, {
        ...task,
        status: "ASSIGNED",
        discoveredAt: new Date().toISOString(),
      });

      // Complete the task
      try {
        const workResult = await completeTask(task);
        await submitWork(task.id, workResult);
        console.log(`Task ${task.id} completed and submitted successfully!`);

        // Remove from assigned tasks after successful completion
        assignedTasks.delete(task.id);
      } catch (error) {
        console.error(`Failed to complete task ${task.id}:`, error.message);
        // Keep in assigned tasks for retry on next poll
      }
    }
  } catch (error) {
    // Silently fail - might be no assigned tasks or API error
    if (error.response) {
      console.error(
        `checkForAcceptedBids API error: ${error.response.status} - ${error.response.data?.error}`,
      );
    }
  }
}

// ===== TASK COMPLETION =====

/**
 * Submit completed work for a task
 */
async function submitWork(taskId, workResult) {
  try {
    const response = await marketplaceApi(
      "POST",
      `/api/tasks/${taskId}/submit`,
      {
        agentId: agentId,
        agentWalletAddress: CONFIG.AGENT_WALLET,
        content: workResult.content,
        resultUri: workResult.resultUri,
        resultHash: workResult.resultHash,
      },
    );

    console.log(`Work submitted for task ${taskId}:`, response.data.message);
    return response.data;
  } catch (error) {
    console.error(
      `Failed to submit work for task ${taskId}:`,
      error.response?.data || error.message,
    );
    throw error;
  }
}

// ===== HEARTBEAT =====

async function sendHeartbeat() {
  if (!apiToken || !agentId) return;

  try {
    const response = await marketplaceApi("POST", "/api/agents/callback", {
      type: "HEARTBEAT",
      metrics: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        assignedTasks: assignedTasks.size,
        timestamp: new Date().toISOString(),
      },
    });

    console.log("Heartbeat sent:", response.data.message);
  } catch (error) {
    console.error("Heartbeat failed:", error.response?.data || error.message);
  }
}

// ===== STATUS ENDPOINTS =====

app.get("/status", (req, res) => {
  res.json({
    agentId,
    name: CONFIG.AGENT_NAME,
    wallet: CONFIG.AGENT_WALLET,
    status: agentStatus,
    registered: !!agentId,
    uptime: process.uptime(),
    criteria: CONFIG.CRITERIA,
    assignedTasks: assignedTasks.size,
    llm: {
      enabled: CONFIG.USE_LLM,
      provider: process.env.LLM_PROVIDER || "ollama",
      available: CONFIG.USE_LLM ? isLLMAvailable() : false,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// LLM test endpoint
app.get("/test-llm", async (req, res) => {
  try {
    const provider = process.env.LLM_PROVIDER || "ollama";
    const llmEnabled = CONFIG.USE_LLM;
    
    if (!llmEnabled) {
      return res.json({
        success: false,
        enabled: false,
        message: "LLM is disabled. Set USE_LLM=true in .env to enable",
        provider: provider,
      });
    }

    const available = isLLMAvailable();
    
    if (!available) {
      return res.json({
        success: false,
        enabled: true,
        available: false,
        provider: provider,
        message: `LLM provider '${provider}' is not available. Check your configuration.`,
        help: provider === "ollama"
          ? "Make sure Ollama is running: ollama serve\nAnd pull a model: ollama pull llama3.2"
          : `Make sure your ${provider.toUpperCase()}_API_KEY is set in .env`
      });
    }

    // Test with a simple prompt
    console.log("[LLM Test] Testing LLM connectivity...");
    const testPrompt = "Respond with only the word 'SUCCESS' and nothing else.";
    const startTime = Date.now();
    
    const response = await generate(testPrompt, { maxTokens: 100 });
    const duration = Date.now() - startTime;
    
    console.log(`[LLM Test] Response: ${response}`);
    console.log(`[LLM Test] Duration: ${duration}ms`);

    // Get model information
    let modelInfo = "unknown";
    if (provider === "ollama") {
      modelInfo = process.env.OLLAMA_MODEL || "llama3.2:latest";
    } else if (provider === "gemini") {
      modelInfo = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    } else if (provider === "openai") {
      modelInfo = process.env.OPENAI_MODEL || "gpt-4o-mini";
    } else if (provider === "anthropic") {
      modelInfo = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
    }

    return res.json({
      success: true,
      enabled: true,
      available: true,
      provider: provider,
      model: modelInfo,
      testResponse: response.trim(),
      responseTime: `${duration}ms`,
      message: "LLM is working correctly! ✅",
    });

  } catch (error) {
    console.error("[LLM Test] Error:", error);
    return res.status(500).json({
      success: false,
      enabled: CONFIG.USE_LLM,
      available: false,
      error: error.message,
      message: "LLM test failed",
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    status: agentStatus,
    message: "Autonomous Agent is running",
    agentId,
    name: CONFIG.AGENT_NAME,
    marketplace: CONFIG.MARKETPLACE_URL,
  });
});

// ===== START SERVER =====

app.listen(CONFIG.PORT, async () => {
  console.log(`\n🚀 Autonomous Agent starting on port ${CONFIG.PORT}`);
  console.log(`   Marketplace: ${CONFIG.MARKETPLACE_URL}`);
  if (LOAD_AGENT_ID) {
    console.log(`   Mode: Load from DB (agent-id: ${LOAD_AGENT_ID})`);
  }
  console.log(`   Agent Name: ${CONFIG.AGENT_NAME}`);
  console.log(`   Wallet: ${CONFIG.AGENT_WALLET}`);
  console.log(`   LLM Enabled: ${CONFIG.USE_LLM}`);
  
  // Initialize LLM if enabled
  if (CONFIG.USE_LLM) {
    await initializeLLM();
    console.log(`   LLM Provider: ${process.env.LLM_PROVIDER || 'gemini'}`);
  } else {
    console.log(`   LLM: Disabled (set USE_LLM=true to enable)`);
  }
  console.log("");

  // Register agent
  await registerAgent();

  // Start heartbeat
  setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL);

  // Start polling (if enabled)
  if (process.env.ENABLE_POLLING === "true") {
    console.log(`Polling enabled (interval: ${CONFIG.POLL_INTERVAL}ms)`);
    setInterval(pollForTasks, CONFIG.POLL_INTERVAL);
  }

  // Periodic bid status check
  setInterval(checkBidStatuses, 30000);

  setInterval(checkForAcceptedBids, 15000); // Check every 15 seconds
});

// Log ALL incoming requests
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log("Headers:", req.headers);
  next();
});
