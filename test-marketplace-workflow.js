#!/usr/bin/env node

/**
 * Marketplace Workflow Test Script
 * Tests the complete marketplace workflow with blockchain transactions
 * Uses mock-agent server for automated bidding
 */
import dotenv from 'dotenv';
import http from 'http';
import https from 'https';

dotenv.config();

// Configuration
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const MOCK_AGENT_URL = process.env.MOCK_AGENT_URL || 'http://localhost:4000';
const CREATOR_WALLET_ADDRESS = process.env.CREATOR_WALLET_ADDRESS;
const AGENT_WALLET_ADDRESS = process.env.AGENT_WALLET_ADDRESS;

// Colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const NC = '\x1b[0m';

// Helper function to make HTTP requests
function httpRequest(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        };
        
        const req = client.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve(body);
                }
            });
        });
        
        req.on('error', reject);
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

// Logging functions
function logInfo(msg) { console.log(`${GREEN}[INFO]${NC} ${msg}`); }
function logWarn(msg) { console.log(`${YELLOW}[WARN]${NC} ${msg}`); }
function logError(msg) { console.log(`${RED}[ERROR]${NC} ${msg}`); }

// Main test workflow
async function runTest() {
    const taskTitle = process.argv[2] || 'Automated Test';
    const reward = parseInt(process.argv[3]) || 100;
    
    console.log('==========================================');
    console.log('Marketplace Workflow Test');
    console.log('==========================================');
    
    // Step 1: Check mock-agent
    logInfo('Checking mock-agent server...');
    const agentStatus = await httpRequest(`${MOCK_AGENT_URL}/status`);
    if (agentStatus.registered) {
        logInfo(`Mock-agent is running (Agent ID: ${agentStatus.agentId})`);
    } else {
        logError('Mock-agent is not running');
        process.exit(1);
    }
    
    logInfo('Configuration:');
    logInfo(`  Creator Wallet: ${CREATOR_WALLET_ADDRESS}`);
    logInfo(`  Agent Wallet: ${AGENT_WALLET_ADDRESS}`);
    logInfo(`  Reward: ${reward} USDC`);
    console.log('');
    
    // Step 2: Create task
    logInfo('Step 1: Creating task...');
    const createResponse = await httpRequest(`${APP_URL}/api/tasks`, 'POST', {
        title: taskTitle,
        description: 'Testing marketplace workflow with blockchain transactions',
        reward: reward,
        tokenSymbol: 'USDC',
        creatorWalletAddress: CREATOR_WALLET_ADDRESS
    });
    
    if (!createResponse.success) {
        logError(`Failed to create task: ${JSON.stringify(createResponse)}`);
        process.exit(1);
    }
    
    const taskId = createResponse.data.id;
    const numericId = createResponse.data.numericId;
    logInfo(`Task created successfully (ID: ${taskId}, Numeric ID: ${numericId})`);
    
    // Step 3: Wait for agent bid
    logInfo('Waiting for agent bid...');
    let bidId = null;
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
        const bidsResponse = await httpRequest(`${APP_URL}/api/tasks/${taskId}/bids`);
        if (bidsResponse.data && bidsResponse.data.length > 0 && bidsResponse.data[0].status === 'PENDING') {
            bidId = bidsResponse.data[0].id;
            logInfo(`Agent bid received (Bid ID: ${bidId})`);
            break;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!bidId) {
        logError('No bid received after 30 seconds');
        process.exit(1);
    }
    
    // Step 4: Accept bid and create escrow
    logInfo('Step 3: Accepting bid...');
    const acceptResponse = await httpRequest(`${APP_URL}/api/tasks/${taskId}/bids`, 'PUT', {
        bidId: bidId,
        status: 'ACCEPTED',
        createEscrow: true,
        escrowAmount: reward
    });
    
    if (!acceptResponse.success) {
        logError(`Failed to accept bid: ${JSON.stringify(acceptResponse)}`);
        process.exit(1);
    }
    
    const escrowId = acceptResponse.escrow.id;
    logInfo(`Bid accepted, escrow created (Escrow ID: ${escrowId})`);
    
    // Step 5: Lock escrow (deposit funds)
    logInfo('Step 4: Locking escrow (depositing funds)...');
    const txHash = `0xmock${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const lockResponse = await httpRequest(`${APP_URL}/api/escrow/deposit`, 'POST', {
        taskId: taskId,
        amount: reward,
        token: 'USDC',
        txHash: txHash
    });
    
    if (!lockResponse.success) {
        logError(`Failed to lock escrow: ${JSON.stringify(lockResponse)}`);
        process.exit(1);
    }
    
    logInfo(`Escrow locked (txHash: ${txHash})`);
    
    // Step 6: Submit work
    logInfo('Step 5: Submitting work...');
    const submitResponse = await httpRequest(`${APP_URL}/api/tasks/${taskId}/submit`, 'POST', {
        walletAddress: AGENT_WALLET_ADDRESS,
        resultUri: `ipfs://QmTest${Date.now()}`,
        data: {
            result: 'Task completed successfully',
            output: 'Test output data'
        }
    });
    
    if (!submitResponse.success) {
        logError(`Failed to submit work: ${JSON.stringify(submitResponse)}`);
        process.exit(1);
    }
    
    const submissionId = submitResponse.data.id;
    logInfo(`Work submitted (Submission ID: ${submissionId})`);
    
    // Step 7: Validate submission and release escrow
    logInfo('Step 6: Validating submission and releasing escrow...');
    const validateResponse = await httpRequest(`${APP_URL}/api/tasks/${taskId}/validate`, 'POST', {
        action: 'approve',
        comments: 'Work completed successfully. Great job!',
        score: 100,
        releaseEscrow: true,
        creatorWallet: CREATOR_WALLET_ADDRESS
    });
    
    if (!validateResponse.success) {
        logError(`Failed to validate submission: ${JSON.stringify(validateResponse)}`);
        process.exit(1);
    }
    
    logInfo('Submission validated, escrow released');
    
    // Step 8: Verify final state
    logInfo('Verifying final state...');
    const finalTask = await httpRequest(`${APP_URL}/api/tasks/${taskId}`);
    const taskStatus = finalTask.data.status;
    const escrowStatus = finalTask.data.escrow?.status;
    
    console.log('');
    logInfo('Final State:');
    logInfo(`  Task Status: ${taskStatus}`);
    logInfo(`  Escrow Status: ${escrowStatus}`);
    
    if (taskStatus === 'COMPLETE' && escrowStatus === 'RELEASED') {
        console.log('');
        logInfo('==========================================');
        logInfo('Workflow completed successfully!');
        logInfo('==========================================');
        process.exit(0);
    } else {
        logError('Workflow did not complete as expected');
        process.exit(1);
    }
}

// Run the test
runTest().catch(err => {
    logError(`Test failed: ${err.message}`);
    process.exit(1);
});