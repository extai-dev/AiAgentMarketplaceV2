#!/bin/bash

# Simple E2E Test without jq
# Tests: Agent Creation → Task Creation → Bidding → Assignment → Completion

BASE_URL="http://localhost:3000/api"

echo "=========================================="
echo "AI Agent Marketplace - E2E Test"
echo "=========================================="

# Generate unique test data with VALID wallet addresses (42 chars: 0x + 40 hex)
# Use fixed valid Ethereum-format addresses for testing
TIMESTAMP=$(date +%s | cut -c1-8)
OWNER_WALLET="0x${TIMESTAMP}0000000000000000000000000000000000"
AGENT_WALLET="0x$(printf '%08x' $((TIMESTAMP + 100)))0000000000000000000000"
CREATOR_WALLET="0x$(printf '%08x' $((TIMESTAMP + 200)))0000000000000000000000"

echo ""
echo "Generated wallet addresses:"
echo "  Owner: $OWNER_WALLET (${#OWNER_WALLET} chars)"
echo "  Agent: $AGENT_WALLET (${#AGENT_WALLET} chars)"
echo "  Creator: $CREATOR_WALLET (${#CREATOR_WALLET} chars)"
echo ""

echo "Step 1: Register Agent"
echo "----------------------------------------"

AGENT_RESPONSE=$(curl -s -X POST "$BASE_URL/agents/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Test AI Agent\",
    \"description\": \"An AI agent for testing\",
    \"walletAddress\": \"$AGENT_WALLET\",
    \"ownerWalletAddress\": \"$OWNER_WALLET\",
    \"execUrl\": \"https://test-agent.example.com/webhook\",
    \"criteria\": {
      \"minReward\": 10,
      \"maxReward\": 1000,
      \"keywords\": [\"AI\", \"data\"],
      \"requireEscrow\": true
    }
  }")

echo "$AGENT_RESPONSE"

# Extract ID using grep/sed
AGENT_ID=$(echo "$AGENT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo ""
echo "Created Agent ID: $AGENT_ID"

echo ""
echo "Step 2: Create User"
echo "----------------------------------------"

USER_RESPONSE=$(curl -s -X POST "$BASE_URL/users" \
  -H "Content-Type: application/json" \
  -d "{
    \"walletAddress\": \"$CREATOR_WALLET\",
    \"name\": \"Task Creator\",
    \"role\": \"user\"
  }")

echo "$USER_RESPONSE"

CREATOR_ID=$(echo "$USER_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo ""
echo "Created User ID: $CREATOR_ID"

echo ""
echo "Step 3: Create Task"
echo "----------------------------------------"

TASK_RESPONSE=$(curl -s -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"AI Data Analysis Task - $TIMESTAMP\",
    \"description\": \"We need AI analysis of our data using machine learning techniques\",
    \"reward\": 50,
    \"tokenSymbol\": \"TT\",
    \"creatorWalletAddress\": \"$CREATOR_WALLET\"
  }")

echo "$TASK_RESPONSE"

TASK_ID=$(echo "$TASK_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
TASK_STATUS=$(echo "$TASK_RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
echo ""
echo "Created Task ID: $TASK_ID, Status: $TASK_STATUS"

echo ""
echo "Step 4: Submit Bid"
echo "----------------------------------------"

# Create bidder user first
BIDDER_WALLET="0x$(printf '%08x' $((TIMESTAMP + 300)))0000000000000000000000"
echo "Bidder Wallet: $BIDDER_WALLET"

BIDDER_RESPONSE=$(curl -s -X POST "$BASE_URL/users" \
  -H "Content-Type: application/json" \
  -d "{
    \"walletAddress\": \"$BIDDER_WALLET\",
    \"name\": \"Bidder User\",
    \"role\": \"user\"
  }")

echo "$BIDDER_RESPONSE"
BIDDER_ID=$(echo "$BIDDER_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Bidder ID: $BIDDER_ID"

# Submit bid on task
BID_RESPONSE=$(curl -s -X POST "$BASE_URL/tasks/$TASK_ID/bids" \
  -H "Content-Type: application/json" \
  -d "{
    \"agentId\": \"$BIDDER_ID\",
    \"amount\": 40,
    \"message\": \"I can complete this task\"
  }")

echo "$BID_RESPONSE"
BID_ID=$(echo "$BID_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Bid ID: $BID_ID"

echo ""
echo "Step 5: Accept Bid (Assign Task)"
echo "----------------------------------------"

# Accept bid by updating task to ASSIGNED
ASSIGN_RESPONSE=$(curl -s -X PUT "$BASE_URL/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"ASSIGNED\",
    \"agentId\": \"$BIDDER_ID\"
  }")

echo "$ASSIGN_RESPONSE"

echo ""
echo "Step 6: Execute Task (IN_PROGRESS)"
echo "----------------------------------------"

EXEC_RESPONSE=$(curl -s -X PUT "$BASE_URL/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"IN_PROGRESS\"
  }")

echo "$EXEC_RESPONSE"

echo ""
echo "Step 7: Submit Work (SUBMITTED)"
echo "----------------------------------------"

SUBMIT_RESPONSE=$(curl -s -X PUT "$BASE_URL/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"SUBMITTED\",
    \"resultHash\": \"0xabc123def456789012345678901234567890123\"
  }")

echo "$SUBMIT_RESPONSE"

echo ""
echo "Step 8: Validate Work (VALIDATING)"
echo "----------------------------------------"

VALIDATE_RESPONSE=$(curl -s -X PUT "$BASE_URL/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"VALIDATING\"
  }")

echo "$VALIDATE_RESPONSE"

echo ""
echo "Step 9: Complete Task (COMPLETE)"
echo "----------------------------------------"

COMPLETE_RESPONSE=$(curl -s -X PUT "$BASE_URL/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"COMPLETE\",
    \"escrowDeposited\": true,
    \"txHash\": \"0xescrow123456789012345678901234567890123\"
  }")

echo "$COMPLETE_RESPONSE"

echo ""
echo "=========================================="
echo "E2E Test Complete!"
echo "=========================================="

# Final task state
echo ""
echo "Final Task State:"
curl -s "$BASE_URL/tasks/$TASK_ID"
echo ""
