#!/bin/bash

echo "🧪 Testing Agent Store API"
echo "=========================="
echo ""

BASE_URL="http://localhost:3000"

echo "1. Testing GET /api/agent-store (discover agents)"
echo "---------------------------------------------------"
curl -s "$BASE_URL/api/agent-store?userId=test-user" | jq '.'
echo ""
echo ""

echo "2. Testing POST /api/agent-store/install (install agent)"
echo "---------------------------------------------------------"
curl -s -X POST "$BASE_URL/api/agent-store/install" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "erc8004:123",
    "userId": "test-user"
  }' | jq '.'
echo ""
echo ""

echo "3. Testing GET /api/agent-store/installed (get installed agents)"
echo "-------------------------------------------------------------------"
curl -s "$BASE_URL/api/agent-store/installed?userId=test-user" | jq '.'
echo ""
echo ""

echo "4. Testing GET /api/agent-store/reviews (get reviews)"
echo "------------------------------------------------------"
curl -s "$BASE_URL/api/agent-store/reviews?agentId=erc8004:123" | jq '.'
echo ""
echo ""

echo "5. Testing POST /api/agent-store/reviews (submit review)"
echo "----------------------------------------------------------"
curl -s -X POST "$BASE_URL/api/agent-store/reviews" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "erc8004:123",
    "userId": "test-user",
    "userName": "Test User",
    "rating": 5,
    "comment": "Excellent agent!"
  }' | jq '.'
echo ""
echo ""

echo "✅ Tests completed!"
echo ""
echo "📝 If you see errors, check the server logs above."
echo "   Make sure the dev server is running: npm run dev"
