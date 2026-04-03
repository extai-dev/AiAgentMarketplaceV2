/**
 * E2E: Multi-Agent Competition — Full lifecycle walkthrough
 *
 * Hits a live Next.js dev server (http://localhost:3000).
 * Runs two real mock HTTP agent servers (localhost:19991 and localhost:19992)
 * that receive the orchestrator's MULTI_AGENT_ROUND dispatches and
 * automatically call back to /multi/submit — testing the complete loop:
 *
 *   Orchestrator → agent execUrl → agent submits → evaluation → terminal state
 *
 * No blockchain transactions are required.
 *
 * Scenarios:
 *   1. Inline multiAgentConfig task creation + bid guard + pull-discovery exclusion
 *   2. Escrow → auto-start → WINNER_TAKE_ALL (dispatch verified, agents self-submit)
 *   3. Manual start → SPLIT_PAYMENT  (dispatch verified, agents self-submit)
 *   4. MERGED_OUTPUT (dispatch verified, agents self-submit)
 *   5. Validation and error paths
 *
 * LLM note:
 *   Scenarios 2–4 poll until COMPLETED or FAILED.  Without an LLM API key the
 *   judge fails and execution reaches FAILED — that outcome is explicitly handled.
 *
 * Prerequisites:
 *   npm run dev   (in my-app/)
 *
 * Run:
 *   npx jest --config jest.e2e.config.js --testPathPatterns=multi-agent-competition --verbose
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as http from 'http';

// ── Config ─────────────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:3000/api';

// Unique per run — all competitor agents are freshly registered each time so
// their execUrl always points to the live mock servers.
const RUN_HEX = Date.now().toString(16).padStart(16, '0');

// Shared fixed wallets
const MAC_OWNER   = '0xcc00000000000000000000000000000000000001';
const MAC_CREATOR = '0xcc00000000000000000000000000000000000005';

// Per-run competitor wallets (valid 40-hex Ethereum addresses)
const MAC_AGENT1  = `0xcc02${RUN_HEX}${'0'.repeat(20)}`;
const MAC_AGENT2  = `0xcc03${RUN_HEX}${'0'.repeat(20)}`;
const MAC_BYSTDR  = `0xcc04${RUN_HEX}${'0'.repeat(20)}`;

// Per-run agent names (avoids name-uniqueness collisions across runs)
const AGENT1_NAME    = `MAC Competitor 1 ${RUN_HEX}`;
const AGENT2_NAME    = `MAC Competitor 2 ${RUN_HEX}`;
const BYSTANDER_NAME = `MAC Bystander ${RUN_HEX}`;

// ── Mock Agent Servers ─────────────────────────────────────────────────────────
//
// These servers receive the orchestrator's HTTP dispatch calls (MULTI_AGENT_ROUND /
// REVISION_REQUESTED) and automatically call back to /multi/submit — replicating
// real agent behaviour without needing a deployed AI agent.

const MOCK_PORT_1 = 19991;
const MOCK_PORT_2 = 19992;
const EXEC_URL_1  = `http://localhost:${MOCK_PORT_1}`;
const EXEC_URL_2  = `http://localhost:${MOCK_PORT_2}`;

/** All payloads received by each mock server, including the raw request headers. */
const server1Received: { headers: http.IncomingHttpHeaders; body: any }[] = [];
const server2Received: { headers: http.IncomingHttpHeaders; body: any }[] = [];

function createMockAgentServer(
  port: number,
  received: { headers: http.IncomingHttpHeaders; body: any }[],
): http.Server {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body: any = {};
      try { body = JSON.parse(raw); } catch { /* ignore malformed */ }

      // Record the full interaction for later assertions
      received.push({ headers: req.headers, body });

      // Acknowledge the dispatch immediately
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ acknowledged: true }));

      // For generation/revision rounds, auto-submit content back to the marketplace.
      // This is what a real AI agent would do after receiving the round notification.
      const type: string = body.type ?? '';
      if (type === 'MULTI_AGENT_ROUND' || type === 'REVISION_REQUESTED') {
        const { taskExecutionId, task, agent, round } = body;
        if (taskExecutionId && task?.id && agent?.id) {
          // Small delay so the acknowledge response is already delivered
          setTimeout(() => {
            fetch(`${API_BASE}/tasks/${task.id}/multi/submit`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                executionId: taskExecutionId,
                agentId: agent.id,
                content:
                  `[Mock Agent ${agent.name} | port ${port}] Round ${round} submission for "${task.title}": ` +
                  `This solution addresses all stated requirements with a layered approach. ` +
                  `Key considerations: performance, reliability, scalability, and maintainability. ` +
                  `Implementation follows established industry patterns with careful attention to edge cases.`,
              }),
            }).catch((err: Error) =>
              // Submission may fail if execution already reached a terminal state — that is fine.
              console.warn(`[MockAgent:${port}] Auto-submit fire-and-forget error (harmless): ${err.message}`),
            );
          }, 100);
        }
      }
    });
  });
}

let mockServer1: http.Server;
let mockServer2: http.Server;

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function get(path: string) {
  const res = await fetch(`${API_BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(path: string, data: object, headers: Record<string, string> = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}

// ── Polling helper ─────────────────────────────────────────────────────────────
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);

async function pollUntilTerminal(
  taskId: string,
  maxWaitMs = 120_000,
  intervalMs = 3_000,
): Promise<{ status: string; data: any }> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await get(`/tasks/${taskId}/multi`);
    const exec = res.body.data;
    if (exec && TERMINAL_STATUSES.has(exec.status)) {
      return { status: exec.status, data: exec };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Execution for task ${taskId} did not reach a terminal state within ${maxWaitMs}ms`);
}

// ── Agent registration ─────────────────────────────────────────────────────────

/**
 * Register a fresh agent (always expects HTTP 201).
 * Per-run unique wallets guarantee there are no pre-existing agents to collide with.
 */
async function registerAgent(
  name: string,
  walletAddress: string,
  execUrl: string,
): Promise<{ id: string; apiToken: string }> {
  const reg = await post('/agents/register', {
    name,
    walletAddress,
    ownerWalletAddress: MAC_OWNER,
    execUrl,
    criteria: { minReward: 1, maxReward: 10_000 },
  });
  if (reg.status !== 201) {
    throw new Error(
      `Agent registration failed [${reg.status}] for "${name}" / ${walletAddress}: ` +
      (reg.body.error ?? JSON.stringify(reg.body)),
    );
  }
  return { id: reg.body.data.id as string, apiToken: reg.body.data.apiToken as string };
}

/** Deposit escrow via the DB-only API path (no blockchain tx needed). */
async function depositEscrow(taskId: string, amount: number) {
  const res = await post('/escrow/deposit', {
    taskId,
    amount,
    token: 'TT',
    txHash: `0xfake_${taskId.slice(-8)}_${Date.now().toString(16)}`,
  });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  return res.body;
}

// ── Shared state ───────────────────────────────────────────────────────────────

let agent1Id: string;
let agent2Id: string;
let bystanderAgentId: string;
let bystanderApiToken: string;

// Set during Scenario 2, used in Scenario 5 error-path tests
let scenario2ExecutionId: string;
let scenario2TaskId: string;

// ── Global setup / teardown ────────────────────────────────────────────────────

beforeAll(async () => {
  // Start mock agent HTTP servers before registering agents
  mockServer1 = createMockAgentServer(MOCK_PORT_1, server1Received);
  mockServer2 = createMockAgentServer(MOCK_PORT_2, server2Received);

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      mockServer1.on('error', reject);
      mockServer1.listen(MOCK_PORT_1, resolve);
    }),
    new Promise<void>((resolve, reject) => {
      mockServer2.on('error', reject);
      mockServer2.listen(MOCK_PORT_2, resolve);
    }),
  ]);
  console.log(`\nMock agent servers listening on :${MOCK_PORT_1} (agent 1) and :${MOCK_PORT_2} (agent 2)`);

  // Register competitor agents pointing at the live mock servers
  const [a1, a2, by] = await Promise.all([
    registerAgent(AGENT1_NAME, MAC_AGENT1, EXEC_URL_1),
    registerAgent(AGENT2_NAME, MAC_AGENT2, EXEC_URL_2),
    registerAgent(BYSTANDER_NAME, MAC_BYSTDR, `http://localhost:19993/bystander`),
  ]);
  agent1Id          = a1.id;
  agent2Id          = a2.id;
  bystanderAgentId  = by.id;
  bystanderApiToken = by.apiToken;
  console.log(`Agent IDs — 1: ${agent1Id}  2: ${agent2Id}  bystander: ${bystanderAgentId}`);
}, 30_000);

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve) => mockServer1?.close(() => resolve())),
    new Promise<void>((resolve) => mockServer2?.close(() => resolve())),
  ]);
});

// =============================================================================
// Scenario 1: Inline config creation + bid guards + pull-discovery exclusion
//
//   Verifies that a multi-agent task:
//     - stores the config but does NOT start an execution until escrow is paid
//     - rejects open bids from non-participating agents
//     - is excluded from agent pull-discovery (GET /agents/callback)
// =============================================================================
describe('Scenario 1: Inline config creation + bid guards + pull-discovery exclusion', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await post('/tasks', {
      title:                `[MAC-S1] Blog post on AI agents — ${Date.now()}`,
      description:          'Write a 500-word article explaining how AI agents collaborate in a marketplace.',
      reward:               50,
      tokenSymbol:          'TT',
      creatorWalletAddress: MAC_CREATOR,
      multiAgentEnabled:    true,
      multiAgentConfig: {
        agentIds:          [agent1Id, agent2Id],
        maxRounds:         2,
        minScoreThreshold: 60,
        selectionMode:     'WINNER_TAKE_ALL',
        judgeModel:        'gemini-2.0-flash',
        judgeProvider:     'gemini',
      },
    });
    expect(res.status).toBe(201);
    taskId = res.body.data.id;
    console.log(`\n[S1] task: ${taskId}`);
  });

  it('task is created OPEN with multiAgentEnabled and config stored', async () => {
    const res = await get(`/tasks/${taskId}`);
    expect(res.status).toBe(200);
    const task = res.body.data;
    expect(task.multiAgentEnabled).toBe(true);
    expect(task.status).toBe('OPEN');
    expect(task.escrowDeposited).toBe(false);

    const cfg = JSON.parse(task.multiAgentConfig);
    expect(cfg.agentIds).toContain(agent1Id);
    expect(cfg.agentIds).toContain(agent2Id);
    expect(cfg.maxRounds).toBe(2);
    expect(cfg.selectionMode).toBe('WINNER_TAKE_ALL');
    expect(cfg.minScoreThreshold).toBe(60);
  });

  it('no execution exists before escrow is deposited', async () => {
    const res = await get(`/tasks/${taskId}/multi`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('no open-bid dispatch was sent — task has zero bids', async () => {
    const res = await get(`/tasks/${taskId}/bids`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('mock agent servers received NO dispatch for this task (execution not started)', () => {
    const dispatched = [...server1Received, ...server2Received].filter(
      (e) => e.body?.task?.id === taskId,
    );
    expect(dispatched).toHaveLength(0);
  });

  it('BID_RESPONSE via POST /agents/callback is rejected with 400', async () => {
    const res = await post(
      '/agents/callback',
      {
        type:     'BID_RESPONSE',
        taskId,
        decision: 'bid',
        amount:   40,
        message:  'Trying to bid on a multi-agent task',
      },
      {
        'X-Agent-ID':  bystanderAgentId,
        Authorization: `Bearer ${bystanderApiToken}`,
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/multi-agent/i);
  });

  it('multi-agent task does NOT appear in agent pull discovery (GET /agents/callback)', async () => {
    const res = await fetch(`${API_BASE}/agents/callback`, {
      headers: {
        'X-Agent-ID':  bystanderAgentId,
        Authorization: `Bearer ${bystanderApiToken}`,
      },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    const pulledTaskIds: string[] = (data.data ?? []).map((n: any) => n.taskId);
    expect(pulledTaskIds).not.toContain(taskId);
  });

  it('rejects creation with only 1 agent in multiAgentConfig', async () => {
    const res = await post('/tasks', {
      title:                `[MAC-S1] Should fail`,
      description:          'Only one agent — must reject.',
      reward:               10,
      tokenSymbol:          'TT',
      creatorWalletAddress: MAC_CREATOR,
      multiAgentEnabled:    true,
      multiAgentConfig: { agentIds: [agent1Id], selectionMode: 'WINNER_TAKE_ALL' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2/i);
  });

  it('rejects creation with an invalid selectionMode', async () => {
    const res = await post('/tasks', {
      title:                `[MAC-S1] Invalid mode`,
      description:          'Bad selectionMode.',
      reward:               10,
      tokenSymbol:          'TT',
      creatorWalletAddress: MAC_CREATOR,
      multiAgentEnabled:    true,
      multiAgentConfig: { agentIds: [agent1Id, agent2Id], selectionMode: 'NOT_A_REAL_MODE' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid selectionMode/i);
  });
});

// =============================================================================
// Scenario 2: Escrow auto-start → WINNER_TAKE_ALL (full dispatch cycle)
//
//   The orchestrator dispatches MULTI_AGENT_ROUND to each agent's execUrl.
//   The mock servers receive those HTTP calls and self-submit — just as a real
//   agent would.  The test verifies the dispatch payload shape, headers, and
//   that the execution reaches a terminal state driven by agent callbacks.
// =============================================================================
describe('Scenario 2: Escrow auto-start → WINNER_TAKE_ALL (live dispatch cycle)', () => {
  let taskId: string;
  let executionId: string;

  // Track how many payloads had already been collected before this scenario
  let preS2Count1: number;
  let preS2Count2: number;

  beforeAll(async () => {
    preS2Count1 = server1Received.length;
    preS2Count2 = server2Received.length;

    const res = await post('/tasks', {
      title:                `[MAC-S2] Design a caching strategy — ${Date.now()}`,
      description:          'Describe a Redis-based caching strategy for a high-traffic REST API. Cover cache invalidation, TTL policies, and eviction.',
      reward:               40,
      tokenSymbol:          'TT',
      creatorWalletAddress: MAC_CREATOR,
      multiAgentEnabled:    true,
      multiAgentConfig: {
        agentIds:          [agent1Id, agent2Id],
        maxRounds:         1,
        minScoreThreshold: 65,
        selectionMode:     'WINNER_TAKE_ALL',
      },
    });
    expect(res.status).toBe(201);
    taskId = res.body.data.id;
    console.log(`\n[S2] task: ${taskId}`);
  });

  it('GET /multi returns null before escrow is deposited', async () => {
    const res = await get(`/tasks/${taskId}/multi`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('depositing escrow auto-starts execution and returns execution metadata', async () => {
    const depositBody = await depositEscrow(taskId, 40);
    expect(depositBody.execution).toBeDefined();
    expect(depositBody.execution.executionId).toBeTruthy();
    expect(depositBody.execution.agentCount).toBe(2);
    expect(depositBody.execution.maxRounds).toBe(1);
    executionId          = depositBody.execution.executionId;
    scenario2ExecutionId = executionId;
    scenario2TaskId      = taskId;
    console.log(`  ↳ executionId: ${executionId}`);
  });

  // ── Dispatch verification ──────────────────────────────────────────────────
  // By the time depositEscrow() returns, the orchestrator has already awaited
  // dispatchMultiAgentRound() for both agents (sequential HTTP calls), so the
  // mock servers have already received and recorded the payloads.

  it('orchestrator dispatched MULTI_AGENT_ROUND to agent 1 execUrl', () => {
    const newPayloads = server1Received.slice(preS2Count1);
    const dispatch    = newPayloads.find((e) => e.body?.task?.id === taskId);
    expect(dispatch).toBeDefined();
    expect(dispatch!.body.type).toBe('MULTI_AGENT_ROUND');
    expect(dispatch!.body.round).toBe(1);
    expect(dispatch!.body.taskExecutionId).toBe(executionId);
    expect(dispatch!.body.agent.id).toBe(agent1Id);
    expect(dispatch!.body.task.title).toContain('[MAC-S2]');
    expect(dispatch!.body.task.escrowDeposited).toBe(true);
    console.log(`  ↳ Agent 1 dispatch payload type: ${dispatch!.body.type}`);
  });

  it('orchestrator dispatched MULTI_AGENT_ROUND to agent 2 execUrl', () => {
    const newPayloads = server2Received.slice(preS2Count2);
    const dispatch    = newPayloads.find((e) => e.body?.task?.id === taskId);
    expect(dispatch).toBeDefined();
    expect(dispatch!.body.type).toBe('MULTI_AGENT_ROUND');
    expect(dispatch!.body.round).toBe(1);
    expect(dispatch!.body.taskExecutionId).toBe(executionId);
    expect(dispatch!.body.agent.id).toBe(agent2Id);
    console.log(`  ↳ Agent 2 dispatch payload type: ${dispatch!.body.type}`);
  });

  it('dispatch includes X-Signature and X-Agent-ID headers', () => {
    const d1 = server1Received.slice(preS2Count1).find((e) => e.body?.task?.id === taskId);
    const d2 = server2Received.slice(preS2Count2).find((e) => e.body?.task?.id === taskId);

    expect(d1!.headers['x-signature']).toBeTruthy();
    expect(d1!.headers['x-agent-id']).toBe(agent1Id);
    expect(d2!.headers['x-signature']).toBeTruthy();
    expect(d2!.headers['x-agent-id']).toBe(agent2Id);
  });

  it('dispatch payload contains the instruction field with executionId and task id', () => {
    const d1 = server1Received.slice(preS2Count1).find((e) => e.body?.task?.id === taskId);
    expect(typeof d1!.body.instruction).toBe('string');
    expect(d1!.body.instruction).toContain(executionId);
    expect(d1!.body.instruction).toContain(taskId);
  });

  // ── Post-start state ───────────────────────────────────────────────────────

  it('task moves to IN_PROGRESS after auto-start', async () => {
    const res = await get(`/tasks/${taskId}`);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.escrowDeposited).toBe(true);
  });

  it('GET /multi shows execution AGENTS_GENERATING with 2 participants', async () => {
    const res  = await get(`/tasks/${taskId}/multi`);
    const exec = res.body.data;
    expect(exec.id).toBe(executionId);
    expect(exec.status).toBe('AGENTS_GENERATING');
    expect(exec.currentRound).toBe(1);
    expect(exec.maxRounds).toBe(1);
    expect(exec.selectionMode).toBe('WINNER_TAKE_ALL');
    expect(exec.participants).toHaveLength(2);
    const ids = exec.participants.map((p: any) => p.agentId);
    expect(ids).toContain(agent1Id);
    expect(ids).toContain(agent2Id);
    for (const p of exec.participants as any[]) {
      expect(p.status).toBe('GENERATING');
    }
  });

  it('depositing escrow a second time does NOT re-start execution', async () => {
    const res = await post('/escrow/deposit', { taskId, amount: 40, token: 'TT' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.execution).toBeUndefined();
  });

  it('returns 400 when trying to start a second execution on the same task', async () => {
    const res = await post(`/tasks/${taskId}/multi/start`, {
      agentIds: [agent1Id, agent2Id],
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── Mock agents self-submit → poll to terminal ─────────────────────────────
  // The mock servers fire auto-submit ~100 ms after receiving the dispatch.
  // We do NOT manually submit here — the full loop is driven by mock agent callbacks.

  it('execution reaches a terminal state driven by mock agent callbacks', async () => {
    const result = await pollUntilTerminal(taskId, 120_000);
    console.log(`  ↳ execution terminal status: ${result.status}`);
    expect(TERMINAL_STATUSES.has(result.status)).toBe(true);
  }, 130_000);

  it('GET /multi/submissions lists both agent submissions', async () => {
    const res = await get(`/tasks/${taskId}/multi/submissions`);
    expect(res.status).toBe(200);
    const { execution, submissions } = res.body.data;
    expect(TERMINAL_STATUSES.has(execution.status)).toBe(true);
    // Both mock agents should have submitted
    const agentIds = submissions.map((s: any) => s.agentId);
    expect(agentIds).toContain(agent1Id);
    expect(agentIds).toContain(agent2Id);
  });

  it('GET /multi/submissions?round=1 returns only round-1 submissions', async () => {
    const res = await get(`/tasks/${taskId}/multi/submissions?round=1`);
    expect(res.status).toBe(200);
    const { submissions } = res.body.data;
    expect(submissions.length).toBeGreaterThanOrEqual(2);
    for (const s of submissions) expect(s.version).toBe(1);
  });

  it('both agents have totalSubmissions ≥ 1', async () => {
    const res          = await get(`/tasks/${taskId}/multi`);
    const participants: any[] = res.body.data.participants;
    for (const p of participants) {
      expect(p.totalSubmissions).toBeGreaterThanOrEqual(1);
    }
  });

  it('if COMPLETED: winner is a competing agent, task is IN_REVIEW, evaluations have scores', async () => {
    const res  = await get(`/tasks/${taskId}/multi`);
    const exec = res.body.data;

    if (exec.status === 'COMPLETED') {
      expect(exec.winnerAgentId).toBeTruthy();
      expect([agent1Id, agent2Id]).toContain(exec.winnerAgentId);

      const taskRes = await get(`/tasks/${taskId}`);
      expect(taskRes.body.data.status).toBe('IN_REVIEW');

      expect(exec.evaluations.length).toBeGreaterThanOrEqual(1);
      for (const e of exec.evaluations as any[]) {
        expect(typeof e.overallScore).toBe('number');
        expect(e.overallScore).toBeGreaterThanOrEqual(0);
        expect(e.overallScore).toBeLessThanOrEqual(100);
      }
      console.log(`  ↳ winner: ${exec.winnerAgentId.slice(-6)}`);
    } else {
      console.warn('  ⚠  Execution FAILED — LLM API key may not be configured');
      expect(exec.status).toBe('FAILED');
    }
  });
});

// =============================================================================
// Scenario 3: Manual start → SPLIT_PAYMENT (live dispatch cycle)
//
//   Task created without inline config.  Escrow deposited (no auto-start).
//   Competition started manually via POST /multi/start.
//   Mock agents receive dispatch and self-submit.
// =============================================================================
describe('Scenario 3: Manual start → SPLIT_PAYMENT (live dispatch cycle)', () => {
  let taskId: string;
  let executionId: string;
  let preS3Count1: number;
  let preS3Count2: number;

  beforeAll(async () => {
    const res = await post('/tasks', {
      title:                `[MAC-S3] Database indexing strategy — ${Date.now()}`,
      description:          'Explain when and how to apply composite indexes in PostgreSQL for OLTP workloads.',
      reward:               35,
      tokenSymbol:          'TT',
      creatorWalletAddress: MAC_CREATOR,
      multiAgentEnabled:    true,
      // No multiAgentConfig — execution started manually after escrow
    });
    expect(res.status).toBe(201);
    taskId = res.body.data.id;
    console.log(`\n[S3] task: ${taskId}`);
  });

  it('GET /multi returns null — no execution started yet', async () => {
    const res = await get(`/tasks/${taskId}/multi`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('POST /multi/start is rejected before escrow is deposited', async () => {
    const res = await post(`/tasks/${taskId}/multi/start`, {
      agentIds:      [agent1Id, agent2Id],
      selectionMode: 'SPLIT_PAYMENT',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/escrow/i);
  });

  it('depositing escrow does NOT auto-start execution (no config stored)', async () => {
    const depositBody = await depositEscrow(taskId, 35);
    expect(depositBody.execution).toBeUndefined();
  });

  it('GET /multi still returns null after escrow-only deposit', async () => {
    const res = await get(`/tasks/${taskId}/multi`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('POST /multi/start with fewer than 2 agents is rejected', async () => {
    const res = await post(`/tasks/${taskId}/multi/start`, {
      agentIds:      [agent1Id],
      selectionMode: 'SPLIT_PAYMENT',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2/i);
  });

  it('starts execution manually with SPLIT_PAYMENT mode — triggers live dispatch to agents', async () => {
    preS3Count1 = server1Received.length;
    preS3Count2 = server2Received.length;

    const res = await post(`/tasks/${taskId}/multi/start`, {
      agentIds:          [agent1Id, agent2Id],
      maxRounds:         1,
      minScoreThreshold: 55,
      selectionMode:     'SPLIT_PAYMENT',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.executionId).toBeTruthy();
    expect(res.body.data.taskId).toBe(taskId);
    expect(res.body.data.agentCount).toBe(2);
    expect(res.body.data.selectionMode).toBe('SPLIT_PAYMENT');
    executionId = res.body.data.executionId;
    console.log(`  ↳ executionId: ${executionId}`);
  });

  it('orchestrator dispatched MULTI_AGENT_ROUND to both agent execUrls on manual start', () => {
    const d1 = server1Received.slice(preS3Count1).find((e) => e.body?.task?.id === taskId);
    const d2 = server2Received.slice(preS3Count2).find((e) => e.body?.task?.id === taskId);

    expect(d1).toBeDefined();
    expect(d1!.body.type).toBe('MULTI_AGENT_ROUND');
    expect(d1!.body.taskExecutionId).toBe(executionId);
    expect(d1!.headers['x-signature']).toBeTruthy();

    expect(d2).toBeDefined();
    expect(d2!.body.type).toBe('MULTI_AGENT_ROUND');
    expect(d2!.body.taskExecutionId).toBe(executionId);
    expect(d2!.headers['x-signature']).toBeTruthy();
  });

  it('GET /multi shows AGENTS_GENERATING with SPLIT_PAYMENT mode', async () => {
    const res  = await get(`/tasks/${taskId}/multi`);
    const exec = res.body.data;
    expect(exec.id).toBe(executionId);
    expect(exec.status).toBe('AGENTS_GENERATING');
    expect(exec.selectionMode).toBe('SPLIT_PAYMENT');
    expect(exec.participants).toHaveLength(2);
  });

  it('task is IN_PROGRESS after execution starts', async () => {
    const res = await get(`/tasks/${taskId}`);
    expect(res.body.data.status).toBe('IN_PROGRESS');
  });

  it('attempting a duplicate start on the same task returns 400', async () => {
    const res = await post(`/tasks/${taskId}/multi/start`, {
      agentIds:      [agent1Id, agent2Id],
      selectionMode: 'WINNER_TAKE_ALL',
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('execution reaches a terminal state driven by mock agent callbacks', async () => {
    const result = await pollUntilTerminal(taskId, 120_000);
    console.log(`  ↳ execution terminal status: ${result.status}`);
    expect(TERMINAL_STATUSES.has(result.status)).toBe(true);
  }, 130_000);

  it('if COMPLETED: rewardPercent is set and totals 100% across participants', async () => {
    const res  = await get(`/tasks/${taskId}/multi`);
    const exec = res.body.data;

    if (exec.status === 'COMPLETED') {
      const rewarded = (exec.participants as any[]).filter(
        (p) => p.rewardPercent !== null && p.rewardPercent !== undefined,
      );
      expect(rewarded.length).toBeGreaterThan(0);
      const totalPercent = rewarded.reduce((sum: number, p: any) => sum + p.rewardPercent, 0);
      expect(totalPercent).toBeCloseTo(100, 0);
      console.log(
        `  ↳ reward split: ${rewarded.map((p: any) => `${p.agentId.slice(-6)}=${p.rewardPercent}%`).join(', ')}`,
      );
    } else {
      console.warn('  ⚠  Execution FAILED — verify LLM API key is configured');
      expect(exec.status).toBe('FAILED');
    }
  });
});

// =============================================================================
// Scenario 4: Inline config → escrow auto-start → MERGED_OUTPUT (live dispatch)
//
//   The judge combines the best parts from all submissions into a merged output.
//   When COMPLETED, execution.mergedOutput should be a non-empty string.
// =============================================================================
describe('Scenario 4: Inline config → escrow auto-start → MERGED_OUTPUT (live dispatch)', () => {
  let taskId: string;
  let executionId: string;
  let preS4Count1: number;
  let preS4Count2: number;

  beforeAll(async () => {
    preS4Count1 = server1Received.length;
    preS4Count2 = server2Received.length;

    const res = await post('/tasks', {
      title:                `[MAC-S4] Explain JWT authentication — ${Date.now()}`,
      description:          'Provide a clear explanation of JWT-based authentication: structure, signing, and validation flow.',
      reward:               30,
      tokenSymbol:          'TT',
      creatorWalletAddress: MAC_CREATOR,
      multiAgentEnabled:    true,
      multiAgentConfig: {
        agentIds:          [agent1Id, agent2Id],
        maxRounds:         1,
        minScoreThreshold: 50,
        selectionMode:     'MERGED_OUTPUT',
      },
    });
    expect(res.status).toBe(201);
    taskId = res.body.data.id;
    console.log(`\n[S4] task: ${taskId}`);
  });

  it('deposits escrow and auto-starts MERGED_OUTPUT execution', async () => {
    const depositBody = await depositEscrow(taskId, 30);
    expect(depositBody.execution).toBeDefined();
    executionId = depositBody.execution.executionId;
    console.log(`  ↳ executionId: ${executionId}`);
  });

  it('orchestrator dispatched MULTI_AGENT_ROUND to both agents on auto-start', () => {
    const d1 = server1Received.slice(preS4Count1).find((e) => e.body?.task?.id === taskId);
    const d2 = server2Received.slice(preS4Count2).find((e) => e.body?.task?.id === taskId);

    expect(d1).toBeDefined();
    expect(d1!.body.type).toBe('MULTI_AGENT_ROUND');
    expect(d1!.body.taskExecutionId).toBe(executionId);
    expect(d1!.headers['x-signature']).toBeTruthy();

    expect(d2).toBeDefined();
    expect(d2!.body.type).toBe('MULTI_AGENT_ROUND');
    expect(d2!.body.taskExecutionId).toBe(executionId);
    expect(d2!.headers['x-signature']).toBeTruthy();
  });

  it('GET /multi confirms selectionMode is MERGED_OUTPUT', async () => {
    const res = await get(`/tasks/${taskId}/multi`);
    expect(res.body.data.selectionMode).toBe('MERGED_OUTPUT');
    expect(res.body.data.status).toBe('AGENTS_GENERATING');
  });

  it('execution reaches a terminal state driven by mock agent callbacks', async () => {
    const result = await pollUntilTerminal(taskId, 120_000);
    console.log(`  ↳ execution terminal status: ${result.status}`);
    expect(TERMINAL_STATUSES.has(result.status)).toBe(true);
  }, 130_000);

  it('if COMPLETED: mergedOutput is populated and task is IN_REVIEW', async () => {
    const res  = await get(`/tasks/${taskId}/multi`);
    const exec = res.body.data;

    if (exec.status === 'COMPLETED') {
      expect(typeof exec.mergedOutput).toBe('string');
      expect(exec.mergedOutput!.length).toBeGreaterThan(10);

      const taskRes = await get(`/tasks/${taskId}`);
      expect(taskRes.body.data.status).toBe('IN_REVIEW');
      console.log(`  ↳ mergedOutput length: ${exec.mergedOutput!.length} chars`);
    } else {
      console.warn('  ⚠  Execution FAILED — verify LLM API key is configured');
      expect(exec.status).toBe('FAILED');
    }
  });
});

// =============================================================================
// Scenario 5: Validation and error paths
// =============================================================================
describe('Scenario 5: Validation and error paths', () => {
  let bareTaskId: string; // plain task with no execution

  beforeAll(async () => {
    const res = await post('/tasks', {
      title:                `[MAC-S5] Validation task — ${Date.now()}`,
      description:          'Used only for error-path validation tests.',
      reward:               5,
      tokenSymbol:          'TT',
      creatorWalletAddress: MAC_CREATOR,
    });
    expect(res.status).toBe(201);
    bareTaskId = res.body.data.id;
  });

  // ── Submission errors ──────────────────────────────────────────────────────

  it('returns 400 when content is missing', async () => {
    const res = await post(`/tasks/${bareTaskId}/multi/submit`, {
      executionId: 'any-id',
      agentId:     agent1Id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/content/i);
  });

  it('returns 400 when executionId is missing', async () => {
    const res = await post(`/tasks/${bareTaskId}/multi/submit`, {
      agentId: agent1Id,
      content: 'some content',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/execution id/i);
  });

  it('returns 400 when both agentId and agentWalletAddress are absent', async () => {
    const res = await post(`/tasks/${bareTaskId}/multi/submit`, {
      executionId: 'any-id',
      content:     'some content',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agent id or wallet/i);
  });

  it('returns 404 when resolving agent by unknown wallet address', async () => {
    const res = await post(`/tasks/${bareTaskId}/multi/submit`, {
      executionId:        'any-id',
      agentWalletAddress: '0x0000000000000000000000000000000000000001',
      content:            'some content',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/agent not found/i);
  });

  it('returns 404 when executionId does not belong to this task', async () => {
    const res = await post(`/tasks/${bareTaskId}/multi/submit`, {
      executionId: 'non-existent-execution-id',
      agentId:     agent1Id,
      content:     'some content',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 403 when agent is not a participant in the execution', async () => {
    if (!scenario2ExecutionId || !scenario2TaskId) {
      console.warn('  ↳ skipped: Scenario 2 did not produce a valid executionId');
      return;
    }
    const outsider = await post('/agents/register', {
      name:               `MAC Outsider — ${Date.now()}`,
      walletAddress:      `0xdd${Date.now().toString(16).padStart(38, '0')}`,
      ownerWalletAddress: MAC_OWNER,
      execUrl:            'http://localhost:19993/outsider',
      criteria:           {},
    });
    expect(outsider.status).toBe(201);
    const outsiderAgentId = outsider.body.data.id as string;

    const res = await post(`/tasks/${scenario2TaskId}/multi/submit`, {
      executionId: scenario2ExecutionId,
      agentId:     outsiderAgentId,
      content:     'Outsider submission attempt',
    });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/not part of this execution/i);
  });

  // ── /multi/start validation errors ────────────────────────────────────────

  it('returns 400 when starting on a non-multi-agent task', async () => {
    const res = await post(`/tasks/${bareTaskId}/multi/start`, {
      agentIds:      [agent1Id, agent2Id],
      selectionMode: 'WINNER_TAKE_ALL',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/multi-agent mode is not enabled/i);
  });

  it('returns 400 for an unrecognised selection mode', async () => {
    const taskRes = await post('/tasks', {
      title:                `[MAC-S5] Bad mode — ${Date.now()}`,
      description:          'Validation task.',
      reward:               5,
      tokenSymbol:          'TT',
      creatorWalletAddress: MAC_CREATOR,
      multiAgentEnabled:    true,
    });
    expect(taskRes.status).toBe(201);
    const validTaskId = taskRes.body.data.id;
    await depositEscrow(validTaskId, 5);

    const res = await post(`/tasks/${validTaskId}/multi/start`, {
      agentIds:      [agent1Id, agent2Id],
      selectionMode: 'INVALID_MODE',
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when one or more agent IDs are unknown', async () => {
    const taskRes = await post('/tasks', {
      title:                `[MAC-S5] Bad agent — ${Date.now()}`,
      description:          'Validation task.',
      reward:               5,
      tokenSymbol:          'TT',
      creatorWalletAddress: MAC_CREATOR,
      multiAgentEnabled:    true,
    });
    const validTaskId = taskRes.body.data.id;
    await depositEscrow(validTaskId, 5);

    const res = await post(`/tasks/${validTaskId}/multi/start`, {
      agentIds: [agent1Id, 'unknown-agent-id-does-not-exist'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/one or more agents not found/i);
  });

  it('returns 404 when the task does not exist', async () => {
    const res = await post('/tasks/non-existent-task-xyz/multi/start', {
      agentIds: [agent1Id, agent2Id],
    });
    expect(res.status).toBe(404);
  });

  // ── /multi status edge cases ───────────────────────────────────────────────

  it('GET /multi returns null for a task with no execution', async () => {
    const res = await get(`/tasks/${bareTaskId}/multi`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();
  });

  it('GET /multi/submissions returns 404 when no execution exists', async () => {
    const res = await get(`/tasks/${bareTaskId}/multi/submissions`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/no execution found/i);
  });

  it('GET /multi returns 200 with null data for a non-existent task', async () => {
    const res = await get('/tasks/non-existent-task-id-xyz/multi');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});
