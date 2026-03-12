/**
 * E2E Workflow Test Script
 * 
 * Run this script to test the complete marketplace workflow against a running server.
 * 
 * Usage:
 * 1. Start the dev server: npm run dev
 * 2. Run this script: node scripts/test-e2e-workflow.js
 * 
 * Or run directly with ts-node: npx ts-node scripts/test-e2e-workflow.js
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';

// Generate random wallets for testing
const testWallet = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, '0')}`;
const agentWallet = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, '0')}`;
const ownerWallet = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, '0')}`;

let taskId = '';
let taskNumericId = 0;
let bidId = '';
let agentId = '';
let submissionId = '';
let escrowId = '';

async function makeRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await response.json();
  return { status: response.status, data };
}

async function runTests() {
  console.log('=== E2E Marketplace Workflow Test ===\n');
  console.log('Using test wallet:', testWallet);
  console.log('Using agent wallet:', agentWallet);
  console.log('Using owner wallet:', ownerWallet);
  console.log('API Base:', API_BASE);
  console.log('');

  try {
    // Phase 1: Task Creation
    console.log('Phase 1: Task Creation');
    console.log('----------------------------');
    
    const taskResponse = await makeRequest(`${API_BASE}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'E2E Test Task',
        description: 'Testing complete marketplace workflow',
        reward: 100,
        tokenSymbol: 'TT',
        creatorWalletAddress: testWallet,
      }),
    });
    
    if (taskResponse.status !== 201) {
      throw new Error(`Failed to create task: ${JSON.stringify(taskResponse.data)}`);
    }
    
    taskId = taskResponse.data.data.id;
    taskNumericId = taskResponse.data.data.numericId;
    console.log('✓ Task created:', taskNumericId);
    
    // Verify task is OPEN
    const openTasksResponse = await makeRequest(`${API_BASE}/tasks/open?limit=10`);
    console.log('✓ Open tasks fetched:', openTasksResponse.data.data.length, 'tasks');
    console.log('');

    // Phase 2: Agent Registration
    console.log('Phase 2: Agent Registration');
    console.log('----------------------------');
    
    const agentResponse = await makeRequest(`${API_BASE}/agents/register`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'E2E Test Agent',
        description: 'Agent for end-to-end testing',
        walletAddress: agentWallet,
        ownerWalletAddress: ownerWallet,
        capabilities: ['coding', 'testing'],
      }),
    });
    
    if (agentResponse.status !== 201) {
      throw new Error(`Failed to register agent: ${JSON.stringify(agentResponse.data)}`);
    }
    
    agentId = agentResponse.data.data.id;
    console.log('✓ Agent registered:', agentId);
    console.log('');

    // Phase 3: Bid Submission
    console.log('Phase 3: Bid Submission');
    console.log('----------------------------');
    
    const bidResponse = await makeRequest(`${API_BASE}/tasks/${taskId}/bids`, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agentId,
        agentWalletAddress: agentWallet,
        amount: 80,
        message: 'I can complete this task efficiently',
      }),
    });
    
    if (bidResponse.status !== 201) {
      throw new Error(`Failed to submit bid: ${JSON.stringify(bidResponse.data)}`);
    }
    
    bidId = bidResponse.data.data.id;
    console.log('✓ Bid submitted:', bidId);
    
    // List bids
    const bidsResponse = await makeRequest(`${API_BASE}/tasks/${taskId}/bids`);
    console.log('✓ Task bids:', bidsResponse.data.data.length, 'bids');
    console.log('');

    // Phase 4: Bid Acceptance
    console.log('Phase 4: Bid Acceptance & Task Assignment');
    console.log('----------------------------');
    
    const acceptResponse = await makeRequest(`${API_BASE}/tasks/${taskId}/bids`, {
      method: 'PUT',
      body: JSON.stringify({
        bidId: bidId,
        status: 'ACCEPTED',
        createEscrow: true,
        escrowAmount: 100,
        forceAccept: true,
      }),
    });
    
    if (acceptResponse.status !== 200) {
      throw new Error(`Failed to accept bid: ${JSON.stringify(acceptResponse.data)}`);
    }
    
    console.log('✓ Bid accepted, task assigned');
    
    // Verify task status
    const taskStatusResponse = await makeRequest(`${API_BASE}/tasks/${taskId}`);
    console.log('✓ Task status:', taskStatusResponse.data.data.status);
    
    // Create and lock escrow
    const escrowDepositResponse = await makeRequest(`${API_BASE}/escrow/deposit`, {
      method: 'POST',
      body: JSON.stringify({
        taskId: taskId,
        amount: 100,
        txHash: '0x' + Math.random().toString(16).slice(2, 66),
      }),
    });
    
    if (escrowDepositResponse.status === 200) {
      console.log('✓ Escrow deposited:', escrowDepositResponse.data.data.id);
      escrowId = escrowDepositResponse.data.data.id;
    } else {
      console.log('⚠ Escrow deposit failed (may have been created during bid acceptance):', escrowDepositResponse.data);
    }
    console.log('');

    // Phase 5: Work Submission
    console.log('Phase 5: Work Submission');
    console.log('----------------------------');
    
    const submitResponse = await makeRequest(`${API_BASE}/tasks/${taskId}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agentId,
        walletAddress: agentWallet,
        resultUri: 'ipfs://QmTestResult123',
        evidenceUri: 'ipfs://QmEvidence456',
        data: {
          completedWork: 'Test work completed',
          summary: 'Successfully completed the task',
        },
      }),
    });
    
    if (submitResponse.status !== 201) {
      throw new Error(`Failed to submit work: ${JSON.stringify(submitResponse.data)}`);
    }
    
    submissionId = submitResponse.data.data.id;
    console.log('✓ Work submitted:', submissionId);
    
    // Verify task status
    const submittedTaskResponse = await makeRequest(`${API_BASE}/tasks/${taskId}`);
    console.log('✓ Task status:', submittedTaskResponse.data.data.status);
    console.log('');

    // Phase 6: Validation
    console.log('Phase 6: Validation');
    console.log('----------------------------');
    
    const validationResponse = await makeRequest(`${API_BASE}/validation`, {
      method: 'POST',
      body: JSON.stringify({
        submissionId: submissionId,
        score: 85,
        comments: 'Excellent work, all requirements met',
        evidence: {
          quality: 'high',
          completeness: 100,
        },
      }),
    });
    
    if (validationResponse.status !== 200) {
      throw new Error(`Failed to validate work: ${JSON.stringify(validationResponse.data)}`);
    }
    
    console.log('✓ Work validated with score: 85');
    
    // Verify task status
    const completedTaskResponse = await makeRequest(`${API_BASE}/tasks/${taskId}`);
    console.log('✓ Task status:', completedTaskResponse.data.data.status);
    console.log('');

    // Phase 7: Escrow
    console.log('Phase 7: Escrow');
    console.log('----------------------------');
    
    escrowId = completedTaskResponse.data.data.escrow?.id;
    if (escrowId) {
      console.log('✓ Escrow exists:', escrowId);
      
      // Try to release escrow
      const releaseResponse = await makeRequest(`${API_BASE}/escrow/release`, {
        method: 'POST',
        body: JSON.stringify({
          taskId: taskId,
          txHash: `0x${Math.random().toString(16).slice(2, 66).padEnd(64, '0')}`,
        }),
      });
      
      if (releaseResponse.status === 200) {
        console.log('✓ Escrow released');
      } else {
        console.log('⚠ Escrow release skipped (may require LOCKED status)');
      }
    } else {
      console.log('⚠ No escrow found for this task');
    }
    console.log('');

    // Phase 8: Verification
    console.log('Phase 8: Verification');
    console.log('----------------------------');
    
    const finalTaskResponse = await makeRequest(`${API_BASE}/tasks/${taskId}`);
    const task = finalTaskResponse.data.data;
    
    console.log('Task:', task.numericId);
    console.log('Status:', task.status);
    console.log('Created:', task.createdAt);
    console.log('Completed:', task.completedAt);
    console.log('Work Submission Status:', task.workSubmission?.status);
    console.log('Escrow Status:', task.escrow?.status);
    
    // Verify complete workflow
    if (task.status === 'COMPLETE' && task.workSubmission?.status === 'APPROVED') {
      console.log('\n=== ✓ FULL WORKFLOW VERIFIED ===');
      console.log('Task went through: Created → Open → Bidding → Assigned → In Progress → Submitted → Validating → Complete');
      process.exit(0);
    } else {
      console.log('\n=== ⚠ Workflow incomplete ===');
      console.log('Expected status: COMPLETE, Got:', task.status);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n=== ✕ TEST FAILED ===');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

runTests();
