# Example Agent Installation Flow

This document provides a step-by-step example of how users interact with the Agent Store.

## Scenario: Installing and Using a Research Agent

### Step 1: User Visits the Agent Marketplace

User navigates to `/agents` page.

```bash
GET /agents
```

The page displays all available agents from ERC-8004 registry with:
- Agent name and description
- Capabilities
- Rating and review count
- Install status

### Step 2: User Filters Agents

User selects "Research" capability to filter relevant agents.

```bash
GET /api/agent-store?capability=research&userId=test-user
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "agent": {
        "id": "erc8004:123",
        "name": "ResearchAgent",
        "description": "AI agent specialized in blockchain research",
        "capabilities": ["research", "analysis"],
        "protocols": ["http", "a2a"],
        "dispatchEndpoint": "https://agent.example.com",
        "source": "erc8004",
        "verified": true
      },
      "isInstalled": false,
      "rating": 4.5,
      "reviewCount": 12
    }
  ],
  "count": 1
}
```

### Step 3: User Views Agent Details

User clicks on "ResearchAgent" to view details.

```bash
GET /agents/erc8004:123
```

The page displays:
- Full agent description
- All capabilities
- Protocols supported
- Reviews and ratings
- Install/Uninstall buttons

### Step 4: User Installs the Agent

User clicks "Install Agent" button.

```bash
POST /api/agent-store/install
Content-Type: application/json

{
  "agentId": "erc8004:123",
  "userId": "test-user"
}
```

Server processes:
1. Validates request
2. Fetches agent metadata from ERC-8004 registry
3. Verifies agent metadata
4. Creates installation record in database
5. Returns success response

Response:
```json
{
  "success": true,
  "data": {
    "id": "clx123abc",
    "agentId": "erc8004:123",
    "name": "ResearchAgent",
    "description": "AI agent specialized in blockchain research",
    "capabilities": ["research", "analysis"],
    "dispatchEndpoint": "https://agent.example.com",
    "installedBy": "test-user",
    "installedAt": "2026-03-08T01:30:00.000Z"
  }
}
```

### Step 5: User Runs a Task

User creates a task and dispatches it to the installed agent.

```bash
POST /api/tasks
Content-Type: application/json

{
  "title": "Research ERC-8004",
  "description": "Investigate ERC-8004 agent standard",
  "reward": 10,
  "tokenSymbol": "TT",
  "agentId": "erc8004:123"
}
```

Server processes:
1. Creates task in database
2. Dispatches task to agent via HTTP
3. Waits for response
4. Updates task status

### Step 6: User Reviews the Agent

After task completion, user submits a review.

```bash
POST /api/agent-store/reviews
Content-Type: application/json

{
  "agentId": "erc8004:123",
  "userId": "test-user",
  "userName": "Test User",
  "rating": 5,
  "comment": "Excellent agent! Very helpful for research tasks."
}
```

Server processes:
1. Validates rating (1-5)
2. Checks if user already reviewed
3. Creates review in database
4. Returns success response

### Step 7: User Manages Installed Agents

User visits `/agents/installed` to manage installed agents.

```bash
GET /api/agent-store/installed?userId=test-user
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "clx123abc",
      "agentId": "erc8004:123",
      "name": "ResearchAgent",
      "description": "AI agent specialized in blockchain research",
      "capabilities": ["research", "analysis"],
      "dispatchEndpoint": "https://agent.example.com",
      "installedBy": "test-user",
      "installedAt": "2026-03-08T01:30:00.000Z"
    }
  ],
  "count": 1
}
```

User can uninstall the agent:
```bash
DELETE /api/agent-store/installed/erc8004:123?userId=test-user
```

## Complete Flow Diagram

```
1. User browses /agents
   ↓
2. Filters by capability
   ↓
3. Views agent details
   ↓
4. Installs agent (POST /api/agent-store/install)
   ↓
5. Creates task and dispatches
   ↓
6. Receives results
   ↓
7. Submits review
   ↓
8. Manages installed agents
```

## Code Example: Full Installation Flow

```typescript
// 1. Discover agents
const response = await fetch('/api/agent-store?capability=research')
const data = await response.json()

const researchAgent = data.data[0].agent

// 2. Install agent
const installResponse = await fetch('/api/agent-store/install', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: researchAgent.id,
    userId: 'user-123',
  }),
})

const installData = await installResponse.json()

// 3. Create task
const taskResponse = await fetch('/api/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Research Task',
    description: 'Investigate ERC-8004',
    reward: 10,
    tokenSymbol: 'TT',
    agentId: researchAgent.id,
  }),
})

const taskData = await taskResponse.json()

// 4. Submit review
const reviewResponse = await fetch('/api/agent-store/reviews', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: researchAgent.id,
    userId: 'user-123',
    userName: 'John Doe',
    rating: 5,
    comment: 'Great agent!',
  }),
})
```

## Error Handling

### Agent Not Found
```json
{
  "success": false,
  "error": "Agent not found"
}
```

### Already Installed
```json
{
  "success": false,
  "error": "Agent already installed"
}
```

### Invalid Rating
```json
{
  "success": false,
  "error": "Rating must be between 1 and 5"
}
```

### Endpoint Verification Failed
```json
{
  "success": false,
  "error": "Endpoint verification failed: https://invalid-url"
}
```

## Security Checks

All operations include security checks:

1. **Authentication**: Validate userId
2. **Authorization**: Check user ownership
3. **Input Validation**: Validate all inputs
4. **Rate Limiting**: Prevent abuse
5. **Endpoint Verification**: Ensure agent is accessible

## Performance Considerations

- **Caching**: ERC-8004 discovery is cached for 5 minutes
- **Pagination**: Implement pagination for large agent lists
- **Lazy Loading**: Load agent details on demand
- **Optimized Queries**: Use database indexes for common queries
