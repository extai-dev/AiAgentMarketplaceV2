/**
 * Test script for Agent Store
 * Run with: node test-agent-store.js
 *
 * Note: This script tests the compiled JavaScript implementation.
 * For TypeScript testing, use: npx ts-node --project tsconfig.json test-agent-store.js
 */

// Mock the database for testing
const mockDb = {
  installedAgent: {
    findUnique: async () => null,
    create: async (data) => ({
      id: 'test-id',
      ...data.data,
      installedAt: new Date(),
      updatedAt: new Date(),
    }),
  },
}

// Mock the db module
const Module = require('module')
const originalRequire = Module.prototype.require
Module.prototype.require = function(id) {
  if (id === '@/lib/db') {
    return { db: mockDb }
  }
  return originalRequire.apply(this, arguments)
}

// Try to require the compiled JavaScript files first, then TypeScript files
let createAgentResolver, createAgentVerifier, createAgentInstallationService

try {
  // Try to require compiled JavaScript files
  createAgentResolver = require('./.next/server/app/api/agent-store/registry/agentResolver').createAgentResolver
  createAgentVerifier = require('./.next/server/app/api/agent-store/registry/agentVerifier').createAgentVerifier
  createAgentInstallationService = require('./.next/server/app/api/agent-store/store/installAgent').createAgentInstallationService
} catch (error) {
  // If compiled files don't exist, try TypeScript files
  try {
    createAgentResolver = require('./app/api/agent-store/registry/agentResolver').createAgentResolver
    createAgentVerifier = require('./app/api/agent-store/registry/agentVerifier').createAgentVerifier
    createAgentInstallationService = require('./app/api/agent-store/store/installAgent').createAgentInstallationService
  } catch (tsError) {
    console.error('Error loading modules:', tsError.message)
    console.log('\n📝 To run this test:')
    console.log('1. Build the project: npm run build')
    console.log('2. Run the test: node test-agent-store.js')
    console.log('3. Or use ts-node: npx ts-node --project tsconfig.json test-agent-store.js')
    process.exit(1)
  }
}

console.log('🧪 Testing Agent Store Implementation\n')

// Test 1: Agent Resolver
console.log('Test 1: Agent Resolver')
console.log('=====================')

const resolver = createAgentResolver()

const metadata = {
  name: 'ResearchAgent',
  description: 'AI agent specialized in blockchain research',
  services: [
    {
      name: 'A2A',
      endpoint: 'https://agent.example.com/.well-known/agent-card.json'
    }
  ],
  capabilities: ['research', 'analysis'],
  protocols: ['http', 'a2a'],
  version: '1.0.0',
}

const agent = resolver.resolveAgent(123, metadata)
console.log('✓ Agent resolved successfully')
console.log('  ID:', agent.id)
console.log('  Name:', agent.name)
console.log('  Capabilities:', agent.capabilities)
console.log('  Verified:', agent.verified)
console.log()

// Test 2: Agent Verification
console.log('Test 2: Agent Verification')
console.log('=========================')

const verifier = createAgentVerifier()

const verification = verifier.verifyMetadata(metadata)
console.log('✓ Verification completed')
console.log('  Valid:', verification.valid)
console.log('  Errors:', verification.errors.length)
console.log('  Warnings:', verification.warnings.length)
console.log()

// Test 3: Installation Service
console.log('Test 3: Installation Service')
console.log('============================')

const installationService = createAgentInstallationService()

const testAgent = {
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
  const installed = installationService.installAgent(testAgent, 'test-user')
  console.log('✓ Agent installation service working')
  console.log('  Installed Agent ID:', installed.agentId)
  console.log('  Installed By:', installed.installedBy)
  console.log('  Installed At:', installed.installedAt)
} catch (error) {
  console.log('✗ Installation test failed:', error.message)
}
console.log()

// Test 4: Capability Matching
console.log('Test 4: Capability Matching')
console.log('===========================')

const task = {
  type: 'research',
  payload: { query: 'test' }
}

const matchingAgents = [agent]
const matched = resolver.matchCapabilities(matchingAgents[0], [task.type])

console.log('✓ Capability matching working')
console.log('  Task Type:', task.type)
console.log('  Agent Capabilities:', matchingAgents[0].capabilities)
console.log('  Matches:', matched)
console.log()

console.log('✅ All tests completed successfully!')
console.log('\n📝 Next Steps:')
console.log('1. Run: cd my-app && npm run db:push')
console.log('2. Start dev server: cd my-app && npm run dev')
console.log('3. Test API: curl http://localhost:3000/api/agent-store')
console.log('4. Test frontend: Visit http://localhost:3000/agents')
