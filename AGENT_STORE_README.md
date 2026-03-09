# Agent Store Module - ERC-8004 Integration

## Overview

The Agent Store module implements a hybrid agent marketplace that combines local agents with ERC-8004 on-chain agents, providing a global agent discovery and execution platform.

## Architecture

```
agent-store/
├── types.ts                    # Core type definitions
├── registry/
│   ├── erc8004Discovery.ts    # ERC-8004 registry discovery with caching
│   ├── agentResolver.ts       # Metadata normalization
│   ├── agentVerifier.ts       # Metadata validation
│   └── cacheService.ts        # In-memory cache
├── store/
│   ├── installAgent.ts        # Installation management
│   └── searchAgents.ts        # Agent search and filtering
├── runtime/
│   ├── dispatchRemoteAgent.ts # Remote execution dispatcher
│   └── capabilityMatcher.ts   # Capability-based routing
└── reputation/
    └── agentRatings.ts        # Review and rating system
```

## Database Schema

### InstalledAgent
```prisma
model InstalledAgent {
  id            String   @id @default(cuid())
  agentId       String   @unique
  name          String
  description   String?
  capabilities  String   @default("[]")
  dispatchEndpoint String
  installedBy   String
  installedAt   DateTime @default(now())
  metadata      String?  // JSON string of ERC-8004 metadata
  updatedAt     DateTime @updatedAt

  user          User     @relation(fields: [installedBy], references: [id])

  @@index([installedBy])
  @@index([agentId])
}
```

### AgentReview
```prisma
model AgentReview {
  id        String   @id @default(cuid())
  agentId   String
  userId    String
  userName  String
  rating    Int
  comment   String?
  createdAt DateTime @default(now())

  @@index([agentId])
  @@index([userId])
}
```

## API Endpoints

### Discovery and Search

#### GET /api/agent-store
Discover agents with optional filters.

**Query Parameters:**
- `capability`: Filter by capability
- `name`: Search by name
- `protocol`: Filter by protocol
- `minRating`: Minimum rating
- `source`: Filter by source (local, erc8004, installed)
- `userId`: User ID for installed agents

**Example:**
```bash
curl "http://localhost:3000/api/agent-store?capability=research&userId=test-user"
```

#### POST /api/agent-store/install
Install an agent into user's workspace.

**Request Body:**
```json
{
  "agentId": "erc8004:123",
  "userId": "user-123"
}
```

### Installed Agents

#### GET /api/agent-store/installed
Get all installed agents for a user.

**Query Parameters:**
- `userId`: User ID

**Example:**
```bash
curl "http://localhost:3000/api/agent-store/installed?userId=test-user"
```

#### DELETE /api/agent-store/installed/:agentId
Uninstall an agent.

**Query Parameters:**
- `userId`: User ID

**Example:**
```bash
curl -X DELETE "http://localhost:3000/api/agent-store/installed/erc8004:123?userId=test-user"
```

### Reviews

#### GET /api/agent-store/reviews
Get reviews for an agent.

**Query Parameters:**
- `agentId`: Agent ID

**Example:**
```bash
curl "http://localhost:3000/api/agent-store/reviews?agentId=erc8004:123"
```

#### POST /api/agent-store/reviews
Submit a review for an agent.

**Request Body:**
```json
{
  "agentId": "erc8004:123",
  "userId": "user-123",
  "userName": "John Doe",
  "rating": 5,
  "comment": "Excellent agent!"
}
```

## Usage Examples

### 1. Discover ERC-8004 Agents

```typescript
import { createERC8004Discovery } from '@/app/api/agent-store/registry/erc8004Discovery'

const discovery = createERC8004Discovery(
  '0x123...abc', // Registry address
  provider // ethers Provider
)

const agents = await discovery.discoverAgents()
console.log(`Found ${agents.length} agents`)
```

### 2. Install an Agent

```typescript
import { createAgentInstallationService } from '@/app/api/agent-store/store/installAgent'

const installationService = createAgentInstallationService()

const agent = {
  id: 'erc8004:123',
  name: 'ResearchAgent',
  description: 'AI agent specialized in blockchain research',
  capabilities: ['research', 'analysis'],
  protocols: ['http'],
  dispatchEndpoint: 'https://agent.example.com',
  source: 'erc8004',
  verified: true,
}

const installed = await installationService.installAgent(agent, 'user-123')
console.log(`Installed: ${installed.name}`)
```

### 3. Search Agents

```typescript
import { createAgentSearchService } from '@/app/api/agent-store/store/searchAgents'

const searchService = createAgentSearchService()

const results = await searchService.searchAgents({
  capability: 'research',
  minRating: 4.0,
  userId: 'user-123',
})

results.forEach(result => {
  console.log(`${result.agent.name} - ${result.rating} stars`)
})
```

### 4. Submit a Review

```typescript
import { createAgentReputationService } from '@/app/api/agent-store/reputation/agentRatings'

const reputationService = createAgentReputationService()

await reputationService.submitReview(
  'erc8004:123',
  'user-123',
  'John Doe',
  5,
  'Excellent agent!'
)
```

### 5. Dispatch a Task to a Remote Agent

```typescript
import { createRemoteAgentDispatcher } from '@/app/api/agent-store/runtime/dispatchRemoteAgent'

const dispatcher = createRemoteAgentDispatcher()

const task = {
  id: 'task-123',
  type: 'research',
  payload: {
    query: 'What is ERC-8004?',
  },
}

const response = await dispatcher.dispatchTask('erc8004:123', task)

if (response.success) {
  console.log('Task executed:', response.result)
} else {
  console.error('Task failed:', response.error)
}
```

## ERC-8004 Agent Metadata Format

```json
{
  "name": "ResearchAgent",
  "description": "AI agent specialized in blockchain research",
  "services": [
    {
      "name": "A2A",
      "endpoint": "https://agent.example.com/.well-known/agent-card.json"
    }
  ],
  "capabilities": ["research", "analysis"],
  "protocols": ["http", "a2a"],
  "version": "1.0.0",
  "author": "Nuwa AI",
  "homepage": "https://nuwa.dev",
  "repository": "https://github.com/nuwa/agent-research",
  "license": "MIT",
  "icon": "ipfs://Qm...",
  "tags": ["research", "blockchain", "ai"],
  "pricing": {
    "type": "free",
    "cost": "0",
    "currency": "TT"
  }
}
```

## Agent Verification

The system validates agents using:

1. **Metadata Validation**: Checks required fields (name, description, services)
2. **Endpoint Validation**: Verifies HTTPS endpoints
3. **Capability Validation**: Ensures capabilities are properly defined
4. **Protocol Validation**: Validates supported protocols

```typescript
import { createAgentVerifier } from '@/app/api/agent-store/registry/agentVerifier'

const verifier = createAgentVerifier()

const result = verifier.verifyMetadata(metadata)

if (result.valid) {
  console.log('Agent is valid')
  console.log('Warnings:', result.warnings)
} else {
  console.error('Agent validation failed:')
  result.errors.forEach(error => console.error('- ', error))
}
```

## Caching Strategy

The ERC-8004 discovery layer uses in-memory caching:

- **Cache TTL**: 5 minutes
- **Cache Key**: `erc8004:discovered_agents`
- **Clear Cache**: Call `discovery.clearCache()`

This reduces RPC calls to the blockchain registry.

## Capability-Based Routing

The system matches tasks to agents based on capabilities:

```typescript
import { createCapabilityMatcher } from '@/app/api/agent-store/runtime/capabilityMatcher'

const matcher = createCapabilityMatcher()

const agents = [
  {
    id: 'erc8004:1',
    name: 'ResearchAgent',
    capabilities: ['research', 'analysis'],
    // ...
  },
  {
    id: 'erc8004:2',
    name: 'CodeAgent',
    capabilities: ['code', 'debug'],
    // ...
  },
]

const task = {
  type: 'research',
  payload: { query: '...' },
}

const matched = matcher.matchAgents(task, agents)
console.log('Matched agents:', matched.length)
```

## Integration with Existing Dispatcher

To integrate with the existing task dispatcher:

```typescript
// In your dispatcher
import { createRemoteAgentDispatcher } from '@/app/api/agent-store/runtime/dispatchRemoteAgent'

const dispatcher = createRemoteAgentDispatcher()

async function dispatchTask(task, agentId) {
  // Try local execution first
  const localResult = await dispatcher.executeLocalAgent(agentId, task)

  if (localResult.success) {
    return localResult
  }

  // Fall back to remote execution
  return await dispatcher.dispatchTask(agentId, task)
}
```

## Security Considerations

1. **Authentication**: Always validate userId before allowing operations
2. **Authorization**: Check user ownership of installed agents
3. **Input Validation**: Validate all inputs before processing
4. **Rate Limiting**: Implement rate limiting for API endpoints
5. **Endpoint Verification**: Verify agent endpoints before execution

## Future Enhancements

- Agent payments and billing
- Bidding marketplace for agent services
- Compute market integration
- Agent reputation syncing across platforms
- Agent staking and slashing mechanisms
- Multi-chain support for ERC-8004
- Agent marketplace with pricing
- Agent versioning and updates
