# Agent Store Testing Guide

## Quick Start

### 1. Start the Development Server

```bash
cd my-app
npm run dev
```

### 2. Test the API Endpoints

Open a new terminal and run:

```bash
cd my-app
chmod +x test-api.sh
./test-api.sh
```

Or test manually:

```bash
# Test 1: Discover agents
curl "http://localhost:3000/api/agent-store?userId=test-user"

# Test 2: Install an agent
curl -X POST http://localhost:3000/api/agent-store/install \
  -H "Content-Type: application/json" \
  -d '{"agentId":"erc8004:123","userId":"test-user"}'

# Test 3: Get installed agents
curl "http://localhost:3000/api/agent-store/installed?userId=test-user"

# Test 4: Get reviews
curl "http://localhost:3000/api/agent-store/reviews?agentId=erc8004:123"

# Test 5: Submit a review
curl -X POST http://localhost:3000/api/agent-store/reviews \
  -H "Content-Type: application/json" \
  -d '{"agentId":"erc8004:123","userId":"test-user","userName":"Test User","rating":5,"comment":"Excellent agent!"}'
```

### 3. Test the Frontend

1. Open browser to `http://localhost:3000/agents`
2. Browse available agents
3. Click on an agent to view details
4. Install the agent
5. Visit `/agents/installed` to manage installed agents
6. Submit a review

## Manual Testing Steps

### Step 1: Verify Database Schema

```bash
cd my-app
npm run db:push
```

Check that the following models were created:
- `InstalledAgent`
- `AgentReview`

### Step 2: Test Agent Resolver

Create a test file `test-resolver.js`:

```javascript
const { createAgentResolver } = require('./app/api/agent-store/registry/agentResolver')

const resolver = createAgentResolver()

const metadata = {
  name: 'ResearchAgent',
  description: 'AI agent specialized in blockchain research',
  services: [{
    name: 'A2A',
    endpoint: 'https://agent.example.com/.well-known/agent-card.json'
  }],
  capabilities: ['research', 'analysis'],
  protocols: ['http', 'a2a'],
  version: '1.0.0',
}

const agent = resolver.resolveAgent(123, metadata)
console.log('✓ Agent resolved:', agent.name)
console.log('✓ Capabilities:', agent.capabilities)
console.log('✓ Verified:', agent.verified)
```

Run it:
```bash
node test-resolver.js
```

### Step 3: Test Agent Verification

```javascript
const { createAgentVerifier } = require('./app/api/agent-store/registry/agentVerifier')

const verifier = createAgentVerifier()

const metadata = {
  name: 'ResearchAgent',
  description: 'AI agent specialized in blockchain research',
  services: [{
    name: 'A2A',
    endpoint: 'https://agent.example.com/.well-known/agent-card.json'
  }],
  capabilities: ['research', 'analysis'],
  protocols: ['http', 'a2a'],
  version: '1.0.0',
}

const result = verifier.verifyMetadata(metadata)
console.log('✓ Valid:', result.valid)
console.log('✓ Errors:', result.errors)
console.log('✓ Warnings:', result.warnings)
```

### Step 4: Test Installation Service

```javascript
const { createAgentInstallationService } = require('./app/api/agent-store/store/installAgent')

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

try {
  const installed = installationService.installAgent(agent, 'test-user')
  console.log('✓ Agent installed:', installed.name)
  console.log('✓ Installed by:', installed.installedBy)
} catch (error) {
  console.log('✗ Error:', error.message)
}
```

## Common Issues and Solutions

### Issue 1: Module Not Found Errors

**Error:**
```
Module not found: Can't resolve '../store/installAgent'
```

**Solution:**
The import paths in route.ts have been fixed. If you still see errors, restart the dev server:

```bash
# Stop the server (Ctrl+C)
# Then restart:
npm run dev
```

### Issue 2: Database Schema Errors

**Error:**
```
Property 'installedAgent' does not exist on type 'PrismaClient'
```

**Solution:**
Run the database migration:

```bash
cd my-app
npm run db:push
npm run db:generate
```

### Issue 3: TypeScript Errors

**Error:**
```
Type 'string' is not assignable to type '"local" | "erc8004" | "installed"'
```

**Solution:**
This has been fixed in the route.ts file. If you see this error, restart the dev server.

### Issue 4: CORS Errors

**Error:**
```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**Solution:**
This is expected when testing from the browser. Use curl or Postman for API testing, or configure CORS if needed.

## Integration Testing

### Test Complete Flow

1. **Discover Agents**
   ```bash
   curl "http://localhost:3000/api/agent-store?userId=test-user"
   ```

2. **Install Agent**
   ```bash
   curl -X POST http://localhost:3000/api/agent-store/install \
     -H "Content-Type: application/json" \
     -d '{"agentId":"erc8004:123","userId":"test-user"}'
   ```

3. **Verify Installation**
   ```bash
   curl "http://localhost:3000/api/agent-store/installed?userId=test-user"
   ```

4. **Submit Review**
   ```bash
   curl -X POST http://localhost:3000/api/agent-store/reviews \
     -H "Content-Type: application/json" \
     -d '{"agentId":"erc8004:123","userId":"test-user","userName":"Test User","rating":5,"comment":"Great agent!"}'
   ```

5. **Get Reviews**
   ```bash
   curl "http://localhost:3000/api/agent-store/reviews?agentId=erc8004:123"
   ```

6. **Uninstall Agent**
   ```bash
   curl -X DELETE "http://localhost:3000/api/agent-store/installed/erc8004:123?userId=test-user"
   ```

## Frontend Testing Checklist

- [ ] Visit `/agents` page loads
- [ ] Search functionality works
- [ ] Capability filters work
- [ ] Agent cards display correctly
- [ ] Clicking an agent shows details
- [ ] Install button works
- [ ] Review submission works
- [ ] `/agents/installed` page loads
- [ ] Uninstall button works

## Performance Testing

### Test Discovery Performance

```bash
# Time the discovery endpoint
time curl "http://localhost:3000/api/agent-store?userId=test-user"
```

Expected: < 1 second (cached), < 10 seconds (uncached)

### Test Installation Performance

```bash
time curl -X POST http://localhost:3000/api/agent-store/install \
  -H "Content-Type: application/json" \
  -d '{"agentId":"erc8004:123","userId":"test-user"}'
```

Expected: < 1 second

## Security Testing

### Test Input Validation

1. Try to install without userId:
   ```bash
   curl -X POST http://localhost:3000/api/agent-store/install \
     -H "Content-Type: application/json" \
     -d '{"agentId":"erc8004:123"}'
   ```

2. Try to submit invalid rating:
   ```bash
   curl -X POST http://localhost:3000/api/agent-store/reviews \
     -H "Content-Type: application/json" \
     -d '{"agentId":"erc8004:123","userId":"test-user","userName":"Test User","rating":10,"comment":"Test"}'
   ```

Expected: Returns error with validation message

## Monitoring

### Check Server Logs

Watch for:
- ✅ No TypeScript errors
- ✅ Successful API responses
- ✅ Database operations logged
- ✅ Error handling working

### Check Database

```bash
cd my-app
npx prisma studio
```

Verify:
- `InstalledAgent` table has records
- `AgentReview` table has reviews
- Relationships are correct

## Next Steps After Testing

1. ✅ Fix any remaining errors
2. ✅ Test with real ERC-8004 registry (when available)
3. ✅ Add authentication
4. ✅ Implement rate limiting
5. ✅ Add comprehensive unit tests
6. ✅ Add integration tests
7. ✅ Deploy to staging environment
8. ✅ Monitor performance
9. ✅ Gather user feedback
10. ✅ Iterate on features

## Support

If you encounter issues:

1. Check the server logs for error messages
2. Verify database schema is up to date
3. Restart the development server
4. Check browser console for frontend errors
5. Review the implementation documentation in [`AGENT_STORE_README.md`](my-app/AGENT_STORE_README.md)

## Success Criteria

✅ All API endpoints respond correctly
✅ Database operations work
✅ Frontend pages load and function
✅ Agent discovery works
✅ Installation/uninstallation works
✅ Reviews can be submitted and retrieved
✅ No TypeScript errors
✅ No runtime errors
✅ Performance is acceptable (< 2s for discovery)

🎉 **Congratulations! The Agent Store is fully functional!**
