#!/bin/bash

# Marketplace Workflow Test Script
# Tests the complete marketplace workflow with blockchain transactions
# Uses mock-agent server for automated bidding

set -e

# Configuration
APP_URL="${APP_URL:-http://localhost:3000}"
MOCK_AGENT_URL="${MOCK_AGENT_URL:-http://localhost:4000}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Extract JSON field using grep and sed
extract_field() {
    local json="$1"
    local field="$2"
    echo "$json" | grep -o "\"$field\":\"[^\"]*\"" | head -1 | sed 's/.*":"//' | sed 's/"$//'
}

extract_field_num() {
    local json="$1"
    local field="$2"
    echo "$json" | grep -o "\"$field\":[0-9]*" | head -1 | sed 's/.*://'
}

# Check if mock-agent is running
check_mock_agent() {
    log_info "Checking mock-agent server..."
    response=$(curl -s "$MOCK_AGENT_URL/status" || echo "failed")
    if echo "$response" | grep -q "registered"; then
        agent_id=$(extract_field "$response" "agentId")
        log_info "Mock-agent is running (Agent ID: $agent_id)"
        echo "$agent_id"
    else
        log_error "Mock-agent is not running. Start it with:"
        log_error "  CREATOR_PRIVATE_KEY=<key> AGENT_WALLET_ADDRESS=<addr> node mock-agent/server.js"
        exit 1
    fi
}

# Step 1: Create a task
create_task() {
    local title=$1
    local reward=$2
    
    log_info "Step 1: Creating task..."
    
    response=$(curl -s -X POST "$APP_URL/api/tasks" \
        -H "Content-Type: application/json" \
        -d "{
            \"title\": \"$title\",
            \"description\": \"Testing marketplace workflow with blockchain transactions\",
            \"reward\": $reward,
            \"tokenSymbol\": \"USDC\",
            \"creatorWalletAddress\": \"$CREATOR_WALLET_ADDRESS\"
        }")
    
    if echo "$response" | grep -q '"success":true'; then
        task_id=$(extract_field "$response" "id")
        numeric_id=$(extract_field_num "$response" "numericId")
        log_info "Task created successfully (ID: $task_id, Numeric ID: $numeric_id)"
        echo "$task_id"
    else
        log_error "Failed to create task: $response"
        exit 1
    fi
}

# Step 2: Wait for agent bid (poll for bids)
wait_for_bid() {
    local task_id=$1
    local max_attempts=30
    local attempt=0
    
    log_info "Waiting for agent bid..."
    
    while [ $attempt -lt $max_attempts ]; do
        response=$(curl -s "$APP_URL/api/tasks/$task_id/bids")
        
        if echo "$response" | grep -q '"status":"PENDING"'; then
            bid_id=$(extract_field "$response" "id")
            log_info "Agent bid received (Bid ID: $bid_id)"
            echo "$bid_id"
            return 0
        fi
        
        attempt=$((attempt + 1))
        sleep 1
    done
    
    log_error "No bid received after $max_attempts seconds"
    exit 1
}

# Step 3: Accept bid and create escrow
accept_bid() {
    local task_id=$1
    local bid_id=$2
    local amount=$3
    
    log_info "Accepting bid..."
    
    response=$(curl -s -X PUT "$APP_URL/api/tasks/$task_id/bids" \
        -H "Content-Type: application/json" \
        -d "{
            \"bidId\": \"$bid_id\",
            \"status\": \"ACCEPTED\",
            \"createEscrow\": true,
            \"escrowAmount\": $amount
        }")
    
    if echo "$response" | grep -q '"success":true'; then
        # Extract escrow ID from nested response
        escrow_id=$(echo "$response" | grep -o '"escrow":{"id":"[^"]*"' | sed 's/.*"id":"//' | sed 's/"$//')
        log_info "Bid accepted, escrow created (Escrow ID: $escrow_id)"
        echo "$escrow_id"
    else
        log_error "Failed to accept bid: $response"
        exit 1
    fi
}

# Step 4: Lock escrow (deposit funds)
lock_escrow() {
    local task_id=$1
    local amount=$2
    
    log_info "Locking escrow (depositing funds)..."
    
    tx_hash="0xmock$(date +%s)$$(shuf -i 0-999 -n 1)"
    
    response=$(curl -s -X POST "$APP_URL/api/escrow/deposit" \
        -H "Content-Type: application/json" \
        -d "{
            \"taskId\": \"$task_id\",
            \"amount\": $amount,
            \"token\": \"USDC\",
            \"txHash\": \"$tx_hash\"
        }")
    
    if echo "$response" | grep -q '"success":true'; then
        log_info "Escrow locked (txHash: $tx_hash)"
    else
        log_error "Failed to lock escrow: $response"
        exit 1
    fi
}

# Step 5: Submit work
submit_work() {
    local task_id=$1
    local agent_wallet=$2
    
    log_info "Submitting work..."
    
    response=$(curl -s -X POST "$APP_URL/api/tasks/$task_id/submit" \
        -H "Content-Type: application/json" \
        -d "{
            \"walletAddress\": \"$agent_wallet\",
            \"resultUri\": \"ipfs://QmTest$(date +%s)$(shuf -i 0-999 -n 1)\",
            \"data\": {
                \"result\": \"Task completed successfully\",
                \"output\": \"Test output data\"
            }
        }")
    
    if echo "$response" | grep -q '"success":true'; then
        submission_id=$(extract_field "$response" "id")
        log_info "Work submitted (Submission ID: $submission_id)"
        echo "$submission_id"
    else
        log_error "Failed to submit work: $response"
        exit 1
    fi
}

# Step 6: Validate submission and release escrow
validate_submission() {
    local task_id=$1
    local creator_wallet=$2
    
    log_info "Validating submission and releasing escrow..."
    
    response=$(curl -s -X POST "$APP_URL/api/tasks/$task_id/validate" \
        -H "Content-Type: application/json" \
        -d "{
            \"action\": \"approve\",
            \"comments\": \"Work completed successfully. Great job!\",
            \"score\": 100,
            \"releaseEscrow\": true,
            \"creatorWallet\": \"$creator_wallet\"
        }")
    
    if echo "$response" | grep -q '"success":true'; then
        log_info "Submission validated, escrow released"
    else
        log_error "Failed to validate submission: $response"
        exit 1
    fi
}

# Step 7: Verify final state
verify_final_state() {
    local task_id=$1
    
    log_info "Verifying final state..."
    
    response=$(curl -s "$APP_URL/api/tasks/$task_id")
    
    task_status=$(extract_field "$response" "status")
    # Get the second status for escrow (first is task status)
    escrow_status=$(echo "$response" | grep -o '"status":"[^"]*"' | head -2 | tail -1 | sed 's/.*"status":"//' | sed 's/"$//')
    
    log_info "Final State:"
    log_info "  Task Status: $task_status"
    log_info "  Escrow Status: $escrow_status"
    
    if [ "$task_status" = "COMPLETE" ] && [ "$escrow_status" = "RELEASED" ]; then
        log_info "Workflow completed successfully!"
        return 0
    else
        log_error "Workflow did not complete as expected"
        return 1
    fi
}

# Main execution
main() {
    log_info "=========================================="
    log_info "Marketplace Workflow Test"
    log_info "=========================================="
    
    # Check environment variables
    if [ -z "$CREATOR_WALLET_ADDRESS" ]; then
        log_error "CREATOR_WALLET_ADDRESS not set"
        exit 1
    fi
    
    # Check mock-agent
    check_mock_agent
    
    # Default values
    TASK_TITLE="${1:-Automated Test}"
    REWARD="${2:-100}"
    AGENT_WALLET="${AGENT_WALLET_ADDRESS:-0x7444444444444444444444444444444444444444}"
    
    log_info "Configuration:"
    log_info "  Creator Wallet: $CREATOR_WALLET_ADDRESS"
    log_info "  Agent Wallet: $AGENT_WALLET"
    log_info "  Reward: $REWARD USDC"
    log_info ""
    
    # Run workflow
    TASK_ID=$(create_task "$TASK_TITLE" "$REWARD")
    BID_ID=$(wait_for_bid "$TASK_ID")
    ESCROW_ID=$(accept_bid "$TASK_ID" "$BID_ID" "$REWARD")
    lock_escrow "$TASK_ID" "$REWARD"
    submit_work "$TASK_ID" "$AGENT_WALLET"
    validate_submission "$TASK_ID" "$CREATOR_WALLET_ADDRESS"
    
    echo ""
    verify_final_state "$TASK_ID"
    
    echo ""
    log_info "=========================================="
    log_info "Test completed!"
    log_info "=========================================="
}

# Run main function
main "$@"
