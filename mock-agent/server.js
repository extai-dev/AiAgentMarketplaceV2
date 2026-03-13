const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = 4000;
const APP_URL = "http://localhost:3000";

// Agent config
const AGENT_NAME = "Test Dispatch Agent";
const AGENT_WALLET = process.env.AGENT_WALLET_ADDRESS; //|| "0x7444444444444444444444444444444444444444";
const OWNER_WALLET = process.env.OWNER_WALLET_ADDRESS; //|| "0x7444444444444444444444444444444444444444";

let API_TOKEN = null;
let AGENT_ID = null;

const processedNotifications = new Set();

// ===== REGISTER AGENT =====
async function registerAgent() {
  try {
    // First, get or create the owner user and get their ID
    console.log('Getting owner user ID...');
    const userRes = await axios.post(`${APP_URL}/api/users`, {
      walletAddress: OWNER_WALLET,
      name: 'Agent Owner',
    });
    
    const ownerId = userRes.data.data.id;
    console.log(`Owner user ID: ${ownerId}`);
    
    const res = await axios.post(`${APP_URL}/api/agents/register`, {
      name: AGENT_NAME,
      description: "Mock agent for dispatch testing",
      walletAddress: AGENT_WALLET,
      ownerId: ownerId,
      execUrl: `http://localhost:${PORT}/task`,
      criteria: {
        minReward: 0,
        maxReward: 100000,
      },
    });

    API_TOKEN = res.data.data.apiToken;
    AGENT_ID = res.data.data.id;

    console.log("Registered successfully");
    console.log("Agent ID:", AGENT_ID);
    console.log("API TOKEN:", API_TOKEN);
  } catch (err) {
    if (err.response?.data?.error?.includes("already registered")) {
      console.warn(
        "Agent already registered. Set API_TOKEN & AGENT_ID manually.",
      );
    } else {
      console.error("Registration failed:", err.response?.data || err.message);
    }
  }
}

// ===== RECEIVE TASK DISPATCH =====
app.post("/task", (req, res) => {
  console.log("Received Task:", req.body);

  const { task, notificationId } = req.body;

  if (!task || !task.id) {
    return res
      .status(400)
      .json({ status: "error", message: "Invalid task payload" });
  }

  // IMMEDIATELY acknowledge receipt
  res.json({ status: "received", message: "Task acknowledged" });

  // Process asynchronously
  processTaskAsync(task, notificationId).catch(console.error);
});

async function processTaskAsync(task, notificationId) {
  // Check if we've already processed this notification
  if (processedNotifications.has(notificationId)) {
    console.log(
      `Notification ${notificationId} already processed, skipping...`,
    );
    return;
  }

  // Mark as processed immediately
  processedNotifications.add(notificationId);

  // Optional: Clean up old entries after 1 hour
  setTimeout(
    () => {
      processedNotifications.delete(notificationId);
    },
    60 * 60 * 1000,
  );

  console.log(`Processing task ${task.id} asynchronously...`);

  // Add a small random delay to reduce race conditions
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));

  const decision = {
    type: "BID_RESPONSE",
    taskId: task.id,
    decision: "bid",
    amount: task.reward,
    message: "I can complete this task.",
    notificationId,
  };

  try {
    const response = await axios.post(
      `${APP_URL}/api/agents/callback`,
      decision,
      {
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "X-Agent-ID": AGENT_ID,
        },
      },
    );

    console.log(`Bid submitted for task ${task.id}:`, response.data);
  } catch (err) {
    console.error(
      `Callback failed for task ${task.id}:`,
      err.response?.data || err.message,
    );
  }
}

// ===== HEARTBEAT FUNCTION =====
async function sendHeartbeat() {
  if (!AGENT_ID || !API_TOKEN) return;

  try {
    const response = await axios.post(
      `${APP_URL}/api/agents/callback`,
      {
        type: "HEARTBEAT",
        metrics: {
          memoryUsage: process.memoryUsage(),
          uptime: process.uptime(),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "X-Agent-ID": AGENT_ID,
        },
      },
    );

    console.log("Heartbeat sent:", response.data.message);
  } catch (err) {
    console.error("Heartbeat failed:", err.response?.data || err.message);
  }
}

// ===== STATUS ENDPOINT =====
// THIS MUST COME BEFORE app.listen()
app.get("/status", (req, res) => {
  res.json({
    agentId: AGENT_ID,
    name: AGENT_NAME,
    wallet: AGENT_WALLET,
    registered: !!AGENT_ID,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint for testing
app.get("/", (req, res) => {
  res.json({
    status: "alive",
    message: "Agent server is running",
    agentId: AGENT_ID,
  });
});

// ===== START SERVER =====
// app.listen() MUST COME AFTER all route definitions
app.listen(PORT, async () => {
  console.log(`Mock Agent running on port ${PORT}`);
  await registerAgent();

  // Start heartbeat interval (every 20 seconds)
  setInterval(sendHeartbeat, 20000);
});
