#!/bin/bash

# End-to-End Test Script for AI Agent Marketplace
# Simplified version without jq

set -e

BASE_URL="http://localhost:3000/api"

echo "=========================================="
echo "AI Agent Marketplace - E2E Test"
echo "=========================================="

# Generate unique test wallets
TIMESTAMP=$(date +%s)
OWNER_WALLET="0xOwner${TIMESTAMP}abcdef123456789abcdef"
AGENT_WALLET="0xAgent${TIMESTAMP}abcdef123456789abcdef1"
CREATOR_WALLET="0xCreator${TIMESTAMP}abcdef123456789abcdef"

echo ""
echo "Step 1: Create Agent"
echo "----------------------------------------"

# Register agent
echo "Creating agent with wallet: $AGENT_WALLET"
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
      \"keywords\": [\"AI\", \"data\", \"analysis\"],
      \"requireEscrow\": true
    }
  }")

echo "Response: $AGENT_RESPONSE"

# Extract using grep/sed (crude but works without jq)
AGENT_ID=$(echo "$AGENT_RESPONSE" | grep -o '"id":"[^"]*' | grep -o '[^"]*$' || echo "unknown")
API_TOKEN=$(echo "$AGENT_RESPONSE" | grep -o '"apiToken":"[^"]*' | grep -o '[^"]*$' || echo "unknown")

echo ""
echo "Agent ID: $AGENT_ID"
echo "API Token: $API_TOKEN"

echo ""
echo "Step 2: Create Task Creator User"
echo "----------------------------------------"

# Create user
USER_RESPONSE=$(curl -s -X POST "$BASE_URL/users" \
  -H "Content-Type: application/json" \
  -d "{
    \"walletAddress\": \"$CREATOR_WALLET\",
    \"name\": \"Task Creator\",
    \"role\": \"user\"
  }")

echo "Response: $USER_RESPONSE"

CREATOR_ID=$(echo "$USER_RESPONSE" | grep -o '"id":"[^"]*' | grep -o '[^"]*$' || echo "unknown")

echo ""
echo "Step 3: Create Task"
echo "----------------------------------------"

# Create task
TASK_RESPONSE=$(curl -s -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"AI Data Analysis Task\",
    \"description\": \"We need AI analysis of our data using machine learning techniques\",
    \"reward\": 50,
    \"tokenSymbol\": \"TT\",
    \"creatorWalletAddress\": \"$CREATOR_WALLET\"
  }")

echo "Response: $TASK_RESPONSE"

TASK_ID=$(echo "$TASK_RESPONSE" | grep -o '"id":"[^"]*' | grep -o '[^"]*$' || echo "unknown")
TASK_STATUS=$(echo "$TASK_RESPONSE" | grep -o '"status":"[^"]*' | grep -o '[^"]*$' || echo "unknown")

echo ""
echo "Task ID: $TASK_ID"
echo "Task Status: $TASK_STATUS"

echo ""
echo "Step 4: Submit Bid"
echo "----------------------------------------"

# Submit bid
BID_RESPONSE=$(curl -s -X POST "$BASE_URL/tasks/$TASK_ID/bids" \
  -H "Content-Type: application/json" \
  -d "{
    \"agentWalletAddress\": \"$AGENT_WALLET\",
    \"amount\": 45,
    \"message\": \"I can analyze your data efficiently using ML techniques.\"
  }")

echo "Response: $BID_RESPONSE"

BID_ID=$(echo "$BID_RESPONSE" | grep -o '"id":"[^"]*' | grep -o '[^"]*$' || echo "unknown")

echo ""
echo "Bid ID: $BID_ID"

echo ""
echo "Step 5: Accept Bid & Assign Task"
echo "----------------------------------------"

# Accept bid - manually assign task to agent
ASSIGN_RESPONSE=$(curl -s -X PUT "$BASE_URL/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"ASSIGNED\",
    \"agentId\": \"$AGENT_ID\",
    \"escrowDeposited\": true
  }")

echo "Response: $ASSIGN_RESPONSE"

echo ""
echo "Step 6: Execute Task (Update to IN_PROGRESS)"
echo "----------------------------------------"

# Update task to in progress
EXECUTE_RESPONSE=$(curl -s -X PUT "$BASE_URL/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"IN_PROGRESS\"
  }")

echo "Response: $EXECUTE_RESPONSE"

echo ""
echo "Step 7: Complete Task"
echo "----------------------------------------"

# Complete task
COMPLETE_RESPONSE=$(curl -s -X PUT "$BASE_URL/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"COMPLETED\",
    \"resultHash\": \"0xResultHash123\"
  }")

echo "Response: $COMPLETE_RESPONSE"

echo ""
echo "=========================================="
echo "E2E Test Complete!"
echo "=========================================="
echo ""
echo "Summary:"
echo "- Agent Created: $AGENT_ID"
echo "- Task Created: $TASK_ID"
echo "- Bid Submitted: $BID_ID"
echo "- Task Status: $TASK_STATUS"