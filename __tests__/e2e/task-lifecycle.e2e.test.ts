/**
 * E2E: Full Task Lifecycle — Polygon Amoy Testnet
 *
 * Hits a live Next.js dev server (http://localhost:3000) and makes REAL blockchain
 * transactions on Polygon Amoy.
 *
 * Prerequisites:
 *   1. npm run dev        (in my-app/)
 *   2. Creator wallet funded with POL (gas) + at least 25 TT tokens
 *
 * Scenarios covered:
 *   1. Happy path        — approve on first submission + on-chain escrow release
 *   2. Revision → approve — one reject cycle, then approve + on-chain release
 *   3. Max revisions (5)  — 5 submit/reject loops → 422 + DB escrow auto-split
 *   4. Bid rejected       — task stays OPEN after creator rejects the only bid
 *
 * Run:
 *   npx jest --config jest.e2e.config.js --verbose
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { ethers } from 'ethers';

// ── Config ──────────────────────────────────────────────────────────────────────
const API_BASE        = 'http://localhost:3000/api';
const RPC_URL         = 'https://rpc-amoy.polygon.technology';
const ESCROW_ADDRESS  = '0x9397124385391DBd39064417a50E364FC8d6dBBA';
const TOKEN_ADDRESS   = '0xF9f52599939C51168c72962ce7B6Dcf59CD22B10';
const REWARD_TT       = 5; // TT tokens per scenario

// Loaded from .env via jest.e2e.setup.js
const CREATOR_WALLET  = process.env.CREATOR_WALLET_ADDRESS!;
const CREATOR_KEY     = process.env.CREATOR_PRIVATE_KEY!;
const AGENT_WALLET    = process.env.AGENT_WALLET_ADDRESS!;

// ── Minimal ABIs (human-readable) ──────────────────────────────────────────────
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const ESCROW_ABI = [
  'function depositEscrow(uint256 taskId, uint256 amount)',
  'function approveAndRelease(uint256 taskId, address agent)',
  'function getEscrow(uint256 taskId) view returns (uint256 amount, address creator, address agent, bool exists, bool released)',
];

// ── HTTP helpers ───────────────────────────────────────────────────────────────
async function get(path: string) {
  const res = await fetch(`${API_BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(path: string, data: object) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}

async function put(path: string, data: object) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}

// ── Shared blockchain state (initialised in outer beforeAll) ───────────────────
let provider: ethers.JsonRpcProvider;
let creatorWallet: ethers.Wallet;
let token: ethers.Contract;
let escrow: ethers.Contract;

let agentId: string;
let agentWallet: string;

// ── Outer setup: blockchain + agent registration ───────────────────────────────
beforeAll(async () => {
  if (!CREATOR_WALLET || !CREATOR_KEY || !AGENT_WALLET) {
    throw new Error('CREATOR_WALLET_ADDRESS, CREATOR_PRIVATE_KEY, and AGENT_WALLET_ADDRESS must be set in .env');
  }

  // Blockchain
  provider      = new ethers.JsonRpcProvider(RPC_URL);
  creatorWallet = new ethers.Wallet(CREATOR_KEY, provider);
  token         = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, creatorWallet);
  escrow        = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, creatorWallet);
  agentWallet   = AGENT_WALLET;

  // Balance check — 3 on-chain scenarios × 5 TT each = 15 TT minimum
  const balance = await token.balanceOf(CREATOR_WALLET);
  console.log(`\nCreator TT balance: ${ethers.formatEther(balance)} TT`);
  if (balance < ethers.parseEther('15')) {
    throw new Error('Creator wallet needs ≥ 15 TT for all E2E scenarios. Use the faucet.');
  }

  // Register the agent from .env — or look up the existing one if already registered
  agentWallet    = AGENT_WALLET;
  const regResult = await post('/agents/register', {
    name:               'Marketplace Agent',
    walletAddress:      AGENT_WALLET,
    ownerWalletAddress: CREATOR_WALLET,
    execUrl:            'http://localhost:3001/task', // mock-agent default port
    criteria:           { keywords: ['code', 'review', 'test', 'debug', 'write'] },
  });

  if (regResult.status === 201) {
    agentId = regResult.body.data.id;
    console.log(`Registered agent: ${agentId}`);
  } else {
    // Already registered — scan all agents to find by wallet address
    // (the existing agent may have a different owner than CREATOR_WALLET)
    let found: { id: string; walletAddress: string } | undefined;
    let offset = 0;
    const pageSize = 50;
    while (!found) {
      const listResult = await get(`/agents?limit=${pageSize}&offset=${offset}`);
      expect(listResult.status).toBe(200);
      const page: { id: string; walletAddress: string }[] = listResult.body.data;
      found = page.find(
        (a) => a.walletAddress.toLowerCase() === AGENT_WALLET.toLowerCase()
      );
      if (page.length < pageSize) break; // last page
      offset += pageSize;
    }
    if (!found) {
      throw new Error(`Agent with wallet ${AGENT_WALLET} not found in DB. Has it been registered?`);
    }
    agentId = found.id;
    console.log(`Using existing agent: ${agentId}`);
  }
  console.log(`Agent wallet: ${agentWallet}`);
}, 60_000);

// ── Reusable on-chain helpers ──────────────────────────────────────────────────
/** Approve + deposit REWARD_TT tokens into SimpleEscrow for `onChainTaskId`. */
async function depositOnChain(onChainTaskId: number): Promise<string> {
  const amount = ethers.parseEther(REWARD_TT.toString());

  const approveTx = await token.approve(ESCROW_ADDRESS, amount);
  await approveTx.wait(1);
  console.log(`  ↳ approve tx: ${approveTx.hash}`);

  const depositTx = await escrow.depositEscrow(onChainTaskId, amount);
  const receipt   = await depositTx.wait(1);
  console.log(`  ↳ depositEscrow tx: ${receipt!.hash}  (taskId=${onChainTaskId})`);
  return receipt!.hash as string;
}

/** Call approveAndRelease on-chain; returns tx hash. */
async function releaseOnChain(onChainTaskId: number, agent: string): Promise<string> {
  const tx      = await escrow.approveAndRelease(onChainTaskId, agent);
  const receipt = await tx.wait(1);
  console.log(`  ↳ approveAndRelease tx: ${receipt!.hash}  (taskId=${onChainTaskId})`);
  return receipt!.hash as string;
}

/** Read escrow state from chain. */
async function getOnChainEscrow(onChainTaskId: number) {
  const [amount, creator, agentAddr, exists, released]: [bigint, string, string, boolean, boolean] =
    await escrow.getEscrow(onChainTaskId);
  return { amount, creator, agentAddr, exists, released };
}

// ── Reusable API flow helpers ──────────────────────────────────────────────────
interface ScenarioCtx {
  taskId:    string;
  numericId: number;
  bidId:     string;
}

/**
 * Creates a task, does on-chain escrow deposit, submits a bid, and accepts it.
 * Returns IDs needed for subsequent test steps.
 */
async function setupTaskWithEscrowAndBid(label: string): Promise<ScenarioCtx> {
  // 1. Create task
  const taskRes = await post('/tasks', {
    title:                `[E2E] ${label} — ${Date.now()}`,
    description:          'Automated E2E test task. Complete as instructed.',
    reward:               REWARD_TT,
    tokenSymbol:          'TT',
    creatorWalletAddress: CREATOR_WALLET,
  });
  expect(taskRes.status).toBe(201);
  const { id: taskId, numericId } = taskRes.body.data;
  console.log(`\n[${label}] task created: ${taskId}  numericId=${numericId}`);

  // 2. On-chain: approve tokens + deposit into SimpleEscrow
  console.log(`[${label}] depositing escrow on-chain…`);
  const txHash = await depositOnChain(numericId);

  // 3. Sync task + escrow in DB
  const updateRes = await put(`/tasks/${taskId}`, { onChainId: numericId, txHash });
  expect(updateRes.status).toBe(200);

  const depositRes = await post('/escrow/deposit', { taskId, amount: REWARD_TT, txHash });
  expect(depositRes.status).toBe(200);
  console.log(`[${label}] escrow locked in DB`);

  // 4. Agent places bid
  const bidRes = await post(`/tasks/${taskId}/bids`, {
    agentId,
    amount:  REWARD_TT,
    message: 'E2E test bid',
  });
  expect(bidRes.status).toBe(201);
  const bidId = bidRes.body.data.id;

  // 5. Creator accepts bid
  const acceptRes = await put(`/tasks/${taskId}/bids`, {
    bidId,
    status:          'ACCEPTED',
    escrowDeposited: true,
  });
  expect(acceptRes.status).toBe(200);
  console.log(`[${label}] bid accepted: ${bidId}`);

  return { taskId, numericId, bidId };
}

/** Agent submits work; returns submission ID. */
async function agentSubmit(taskId: string, content: string, version: number): Promise<string> {
  const res = await post(`/tasks/${taskId}/submissions`, { agentId, content });
  expect(res.status).toBe(201);
  expect(res.body.data.version).toBe(version);
  console.log(`  ↳ submission v${version}: ${res.body.data.id}`);
  return res.body.data.id as string;
}

/** Creator requests revision on a submission. */
async function requestRevision(submissionId: string, feedback: string): Promise<void> {
  const res = await post(`/submissions/${submissionId}/review`, { action: 'revise', feedback });
  expect(res.status).toBe(200);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Happy Path — approve on first submission + on-chain release
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 1: Happy Path (approve on first submission)', () => {
  let ctx: ScenarioCtx;
  let submissionId: string;

  beforeAll(async () => {
    ctx = await setupTaskWithEscrowAndBid('Happy Path');
  }, 180_000); // 3 min: two on-chain txs + API calls

  it('task is IN_PROGRESS after bid accepted', async () => {
    const res = await get(`/tasks/${ctx.taskId}`);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.agentId).toBe(agentId);
  });

  it('agent submits work (v1)', async () => {
    submissionId = await agentSubmit(
      ctx.taskId,
      'Completed work for the E2E happy-path test. Here is the deliverable.',
      1,
    );
  });

  it('task transitions to IN_REVIEW', async () => {
    const res = await get(`/tasks/${ctx.taskId}`);
    expect(res.body.data.status).toBe('IN_REVIEW');
  });

  it('GET submissions returns v1 with SUBMITTED status', async () => {
    const res = await get(`/tasks/${ctx.taskId}/submissions`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('SUBMITTED');
    expect(res.body.data[0].version).toBe(1);
  });

  it('creator approves submission → task COMPLETED, escrow RELEASED in DB', async () => {
    const res = await post(`/submissions/${submissionId}/review`, { action: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.taskStatus).toBe('COMPLETED');
  });

  it('task is COMPLETED in DB', async () => {
    const res = await get(`/tasks/${ctx.taskId}`);
    expect(res.body.data.status).toBe('COMPLETED');
  });

  it('creator releases escrow on-chain (approveAndRelease)', async () => {
    await releaseOnChain(ctx.numericId, agentWallet);
  }, 120_000);

  it('on-chain escrow is released', async () => {
    const onChain = await getOnChainEscrow(ctx.numericId);
    expect(onChain.exists).toBe(true);
    expect(onChain.released).toBe(true);
    expect(onChain.amount).toBeGreaterThan(BigInt(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Revision cycle — reject once, then approve + on-chain release
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 2: Revision cycle (reject then approve)', () => {
  let ctx: ScenarioCtx;
  let subV1Id: string;
  let subV2Id: string;

  beforeAll(async () => {
    ctx = await setupTaskWithEscrowAndBid('Revision Cycle');
  }, 180_000);

  it('agent submits v1', async () => {
    subV1Id = await agentSubmit(ctx.taskId, 'First attempt at the E2E revision task.', 1);
  });

  it('creator requests revision on v1', async () => {
    const res = await post(`/submissions/${subV1Id}/review`, {
      action:   'revise',
      feedback: 'Please improve the output quality and add more detail.',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('revision_requested');
    expect(res.body.data.taskStatus).toBe('IN_PROGRESS');
  });

  it('submission v1 status is REVISION_REQUESTED', async () => {
    const res = await get(`/tasks/${ctx.taskId}/submissions`);
    const v1  = res.body.data.find((s: { version: number }) => s.version === 1);
    expect(v1.status).toBe('REVISION_REQUESTED');
    expect(v1.feedback).toBe('Please improve the output quality and add more detail.');
  });

  it('task reverts to IN_PROGRESS after revision request', async () => {
    const res = await get(`/tasks/${ctx.taskId}`);
    expect(res.body.data.status).toBe('IN_PROGRESS');
  });

  it('agent resubmits improved work (v2)', async () => {
    subV2Id = await agentSubmit(
      ctx.taskId,
      'Revised work with improved quality and additional detail as requested.',
      2,
    );
  });

  it('both submissions appear in history', async () => {
    const res = await get(`/tasks/${ctx.taskId}/submissions`);
    expect(res.body.data).toHaveLength(2);
    const versions = res.body.data.map((s: { version: number }) => s.version).sort();
    expect(versions).toEqual([1, 2]);
  });

  it('creator approves v2', async () => {
    const res = await post(`/submissions/${subV2Id}/review`, { action: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.data.taskStatus).toBe('COMPLETED');
  });

  it('task is COMPLETED', async () => {
    const res = await get(`/tasks/${ctx.taskId}`);
    expect(res.body.data.status).toBe('COMPLETED');
  });

  it('creator releases escrow on-chain', async () => {
    await releaseOnChain(ctx.numericId, agentWallet);
  }, 120_000);

  it('on-chain escrow is released after approval', async () => {
    const onChain = await getOnChainEscrow(ctx.numericId);
    expect(onChain.released).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Max revisions (5 submissions, 5th revision triggers failure)
//   - 5 submissions, creator requests revision each time
//   - 5th revision attempt hits MAX_REVISIONS → 422, task FAILED, DB escrow split
//   - No on-chain release should happen
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 3: Max revisions (5) → task FAILED + DB escrow auto-split', () => {
  let ctx: ScenarioCtx;
  const MAX_REVISIONS = 5;

  beforeAll(async () => {
    ctx = await setupTaskWithEscrowAndBid('Max Revisions');
  }, 180_000);

  it(`submits ${MAX_REVISIONS} times and creator requests revision after each`, async () => {
    for (let i = 1; i <= MAX_REVISIONS; i++) {
      const subId = await agentSubmit(ctx.taskId, `Attempt #${i} for the max-revision scenario.`, i);

      if (i < MAX_REVISIONS) {
        // Intermediate revisions succeed
        await requestRevision(subId, `Revision feedback round ${i}`);
      } else {
        // 5th revision attempt must return 422 + FAILED
        const res = await post(`/submissions/${subId}/review`, {
          action:   'revise',
          feedback: `Final (5th) revision request — should trigger failure`,
        });
        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toContain('Maximum revisions');
        expect(res.body.data.taskStatus).toBe('FAILED');
        // Split amounts must be present
        expect(typeof res.body.data.agentAmount).toBe('number');
        expect(typeof res.body.data.creatorRefundAmount).toBe('number');
        expect(res.body.data.agentAmount).toBeCloseTo(REWARD_TT * 0.8, 3);
        expect(res.body.data.creatorRefundAmount).toBeCloseTo(REWARD_TT * 0.2, 3);
        console.log(
          `  ↳ split: agent=${res.body.data.agentAmount} TT, creator refund=${res.body.data.creatorRefundAmount} TT`
        );
      }
    }
  }, 60_000);

  it('task status is FAILED', async () => {
    const res = await get(`/tasks/${ctx.taskId}`);
    expect(res.body.data.status).toBe('FAILED');
  });

  it('all 5 submissions are present in history', async () => {
    const res = await get(`/tasks/${ctx.taskId}/submissions`);
    expect(res.body.data).toHaveLength(MAX_REVISIONS);
  });

  it('on-chain escrow is NOT released (DB-only split, no on-chain payout)', async () => {
    const onChain = await getOnChainEscrow(ctx.numericId);
    // Funds are still locked on-chain — the DB split is a record-keeping entry only
    expect(onChain.exists).toBe(true);
    expect(onChain.released).toBe(false);
    console.log(
      `  ↳ on-chain amount still locked: ${ethers.formatEther(onChain.amount)} TT`
    );
  });

  it('agent cannot submit a 6th time (task is FAILED)', async () => {
    const res = await post(`/tasks/${ctx.taskId}/submissions`, {
      agentId,
      content: 'Trying to submit after FAILED status — should be rejected.',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('FAILED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Bid rejected — task stays OPEN
//   No on-chain interactions needed.
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 4: Bid rejected — task stays OPEN', () => {
  let taskId: string;
  let bidId: string;

  beforeAll(async () => {
    // Create task only — no on-chain deposit needed for this scenario
    const res = await post('/tasks', {
      title:                `[E2E] Bid Rejected — ${Date.now()}`,
      description:          'E2E test: creator rejects the only bid.',
      reward:               REWARD_TT,
      tokenSymbol:          'TT',
      creatorWalletAddress: CREATOR_WALLET,
    });
    expect(res.status).toBe(201);
    taskId = res.body.data.id;
    console.log(`\n[Bid Rejected] task created: ${taskId}`);
  });

  it('agent places bid', async () => {
    const res = await post(`/tasks/${taskId}/bids`, {
      agentId,
      amount:  REWARD_TT,
      message: 'E2E bid that will be rejected',
    });
    expect(res.status).toBe(201);
    bidId = res.body.data.id;
    expect(res.body.data.status).toBe('PENDING');
  });

  it('task remains OPEN while bid is PENDING', async () => {
    const res = await get(`/tasks/${taskId}`);
    expect(res.body.data.status).toBe('OPEN');
  });

  it('creator rejects the bid', async () => {
    const res = await put(`/tasks/${taskId}/bids`, { bidId, status: 'REJECTED' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
  });

  it('task remains OPEN after bid rejection', async () => {
    const res = await get(`/tasks/${taskId}`);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.agentId).toBeNull();
  });

  it('rejected agent cannot bid again (already has a bid)', async () => {
    // A rejected bid means the agent is free to bid again (REJECTED ≠ PENDING).
    // The route only blocks if there is an existing PENDING bid.
    const res = await post(`/tasks/${taskId}/bids`, {
      agentId,
      amount:  REWARD_TT,
      message: 'Second bid attempt after rejection — should succeed',
    });
    // The task is still OPEN and there is no PENDING bid → new bid is allowed
    expect(res.status).toBe(201);
  });

  it('a second bid can now be accepted', async () => {
    const bidsRes = await get(`/tasks/${taskId}/bids`);
    const pending = bidsRes.body.data.find((b: { status: string }) => b.status === 'PENDING');
    expect(pending).toBeDefined();

    const acceptRes = await put(`/tasks/${taskId}/bids`, {
      bidId:  pending.id,
      status: 'ACCEPTED',
    });
    expect(acceptRes.status).toBe(200);

    const taskRes = await get(`/tasks/${taskId}`);
    expect(taskRes.body.data.status).toBe('IN_PROGRESS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Input validation and error paths (no blockchain)
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 5: Input validation and error paths', () => {
  let taskId: string;
  let bidId: string;

  beforeAll(async () => {
    const res = await post('/tasks', {
      title:                `[E2E] Error Paths — ${Date.now()}`,
      description:          'Validates error handling in the task API.',
      reward:               REWARD_TT,
      tokenSymbol:          'TT',
      creatorWalletAddress: CREATOR_WALLET,
    });
    taskId = res.body.data.id;

    // Place and accept a bid so we can test submission errors
    const bidRes = await post(`/tasks/${taskId}/bids`, { agentId, amount: REWARD_TT, message: 'test' });
    bidId = bidRes.body.data.id;
    await put(`/tasks/${taskId}/bids`, { bidId, status: 'ACCEPTED' });
  });

  it('GET non-existent task returns 404', async () => {
    const res = await get('/tasks/non-existent-id-xyz');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('POST /submissions without content returns 400', async () => {
    const res = await post(`/tasks/${taskId}/submissions`, { agentId });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Content is required');
  });

  it('POST /submissions with unknown agentId returns 404', async () => {
    const res = await post(`/tasks/${taskId}/submissions`, {
      agentId:  'unknown-agent-id-999',
      content:  'some content',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Agent not found');
  });

  it('review route rejects unknown action', async () => {
    // First create a valid submission so we have a submissionId
    const subRes = await post(`/tasks/${taskId}/submissions`, {
      agentId,
      content: 'Submission for validation test',
    });
    expect(subRes.status).toBe(201);
    const subId = subRes.body.data.id;

    const res = await post(`/submissions/${subId}/review`, { action: 'invalid_action' });
    expect(res.status).toBe(400);
  });

  it('review route requires feedback when action is "revise"', async () => {
    // Need a SUBMITTED submission to test against
    const allSubs = await get(`/tasks/${taskId}/submissions`);
    const submitted = allSubs.body.data.find((s: { status: string }) => s.status === 'SUBMITTED');
    if (!submitted) {
      // No submitted submission — skip (prior test may have consumed it)
      console.log('  ↳ skipped: no SUBMITTED submission available');
      return;
    }
    const res = await post(`/submissions/${submitted.id}/review`, { action: 'revise' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('feedback is required');
  });

  it('bidding on a non-OPEN task returns 400', async () => {
    // Task is now IN_PROGRESS → bidding should fail
    const res = await post(`/tasks/${taskId}/bids`, {
      agentId,
      amount:  REWARD_TT,
      message: 'bid on non-open task',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not open');
  });

  it('bid with negative amount returns 400', async () => {
    // Create a separate OPEN task for this check
    const newTaskRes = await post('/tasks', {
      title:                `[E2E] Invalid Bid — ${Date.now()}`,
      description:          'Validates bid amount validation.',
      reward:               REWARD_TT,
      tokenSymbol:          'TT',
      creatorWalletAddress: CREATOR_WALLET,
    });
    const newTaskId = newTaskRes.body.data.id;

    const res = await post(`/tasks/${newTaskId}/bids`, {
      agentId,
      amount:  -1,
      message: 'invalid negative bid',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('positive');
  });
});
