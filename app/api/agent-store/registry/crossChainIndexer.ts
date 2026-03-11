import { ethers } from "ethers";
import { db } from "@/lib/db";

// ERC-8004 registry addresses (same on all mainnets, different on testnets)
const REGISTRY_ADDRESSES = {
  mainnet: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  testnet: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

// Default scanning configuration
const DEFAULT_BLOCK_CHUNK_SIZE = 2000; // Increased for better coverage
const DEFAULT_RATE_LIMIT_DELAY = 500; // ms between chunk requests
const MAX_RETRIES = 3;

// Supported chains with reliable RPC endpoints
const CHAINS = [
  {
    name: "ethereum",
    chainId: 1,
    rpc: process.env.ETHEREUM_RPC_URL || "https://eth.drpc.org",
    fallbackRpc: "https://ethereum.publicnode.com",
    isTestnet: false,
    blockChunkSize: DEFAULT_BLOCK_CHUNK_SIZE,
    requiresApiKey: false,
    apiKeyEnv: undefined,
    headers: undefined,
  },
  {
    name: "base",
    chainId: 8453,
    rpc: process.env.BASE_RPC_URL || "https://base.drpc.org",
    fallbackRpc: "https://base.publicnode.com",
    isTestnet: false,
    blockChunkSize: DEFAULT_BLOCK_CHUNK_SIZE,
    requiresApiKey: false,
    apiKeyEnv: undefined,
    headers: undefined,
  },
  {
    name: "polygon",
    chainId: 137,
    rpc: process.env.POLYGON_RPC_URL || "https://polygon.drpc.org",
    fallbackRpc: "https://polygon-bor.publicnode.com",
    isTestnet: false,
    blockChunkSize: DEFAULT_BLOCK_CHUNK_SIZE,
    requiresApiKey: false,
    apiKeyEnv: undefined,
    headers: undefined,
  },
  {
    name: "polygon-amoy",
    chainId: 80002,
    rpc: process.env.POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
    fallbackRpc: "https://polygon-amoy-bor-rpc.publicnode.com",
    isTestnet: true,
    blockChunkSize: DEFAULT_BLOCK_CHUNK_SIZE,
    requiresApiKey: false,
    apiKeyEnv: undefined,
    headers: undefined,
  },
];

// FIXED: Use proper ABI format with both event definitions
const ABI = [
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)",
];

// Create the interface for proper event parsing
const INTERFACE = new ethers.Interface(ABI);

interface Agent {
  chain: string;
  chainId: number;
  agentId: string;
  owner: string;
  agentURI: string;
  name?: string;
  description?: string;
  capabilities?: string[];
  services?: any[];
  endpoint?: string;
}

/**
 * Create a provider with retry logic and fallback RPC
 */
async function createProviderWithRetry(
  chain: (typeof CHAINS)[0],
  retryCount = 0
): Promise<ethers.JsonRpcProvider | null> {
  const rpcUrl = retryCount === 0 ? chain.rpc : chain.fallbackRpc;

  try {
    // Add API key if required
    let url = rpcUrl;
    if (chain.requiresApiKey && chain.apiKeyEnv && process.env[chain.apiKeyEnv]) {
      url = `${rpcUrl}/${process.env[chain.apiKeyEnv]}`;
    }

    const provider = new ethers.JsonRpcProvider(url);

    // Test the connection with timeout
    const blockNumber = await Promise.race([
      provider.getBlockNumber(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), 10000)
      ),
    ]);

    if (blockNumber === null) {
      throw new Error("Failed to get block number");
    }

    console.log(`Chain ${chain.name}: Connected to ${url.split("/")[2]} (block ${blockNumber})`);

    return provider;
  } catch (error: any) {
    console.warn(
      `Chain ${chain.name}: Failed to connect to ${rpcUrl}:`,
      error?.message || error
    );

    if (retryCount < MAX_RETRIES) {
      console.log(`Chain ${chain.name}: Retrying with fallback (attempt ${retryCount + 1})...`);
      return createProviderWithRetry(chain, retryCount + 1);
    }

    return null;
  }
}

/**
 * Get the registry address for a chain based on whether it's a testnet
 */
function getRegistryAddress(isTestnet: boolean): string {
  return isTestnet ? REGISTRY_ADDRESSES.testnet : REGISTRY_ADDRESSES.mainnet;
}

/**
 * Get the last indexed block for a chain from the database
 */
async function getLastIndexedBlock(
  chain: string,
  provider: ethers.JsonRpcProvider
): Promise<number> {
  const state = await db.indexingState.findUnique({
    where: { chain },
  });

  if (state) return state.lastIndexedBlock;

  // First run - scan last 100000 blocks for better coverage
  const current = await provider.getBlockNumber();
  const startBlock = Math.max(0, current - 100000);

  console.log(`Chain ${chain}: First time indexing - starting from block ${startBlock}`);
  return startBlock;
}

/**
 * Update the last indexed block for a chain in the database
 */
async function updateLastIndexedBlock(chain: string, blockNumber: number): Promise<void> {
  await db.indexingState.upsert({
    where: { chain },
    update: {
      lastIndexedBlock: blockNumber,
      indexedAt: new Date(),
    },
    create: {
      chain,
      lastIndexedBlock: blockNumber,
      indexedAt: new Date(),
    },
  });
}

/**
 * Check if a string is valid JSON
 */
function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a string is a valid URL
 */
function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ipfs:";
  } catch {
    return false;
  }
}

/**
 * Fetch agent metadata from the agentURI with multiple format support
 * Handles: URLs, IPFS URIs, data URIs, and direct JSON strings
 */
async function resolveAgentMetadata(agent: Agent): Promise<Agent> {
  try {
    const uri = agent.agentURI.trim();
    let metadata: any;

    // Case 1: Empty or undefined URI
    if (!uri || uri === "") {
      return createDefaultAgent(agent, "Empty agentURI");
    }

    // Case 2: Direct JSON string (some agents store metadata directly)
    // This is the case for errors like: Failed to parse URL from {"name":"ape_gasgano",...}
    if (uri.startsWith("{") || uri.startsWith("[")) {
      try {
        metadata = JSON.parse(uri);
        return buildAgentFromMetadata(agent, metadata);
      } catch (parseError) {
        console.warn(
          `Agent ${agent.agentId} (${agent.chain}): agentURI looks like JSON but failed to parse`
        );
      }
    }

    // Case 3: Data URI (base64 encoded)
    if (uri.startsWith("data:")) {
      // Handle base64 encoded JSON
      const base64Match = uri.match(/data:application\/json;base64,(.+)/i);
      if (base64Match) {
        const decoded = Buffer.from(base64Match[1], "base64").toString("utf-8");
        metadata = JSON.parse(decoded);
        return buildAgentFromMetadata(agent, metadata);
      }

      // Handle plain JSON data URI
      const jsonMatch = uri.match(/data:application\/json;?charset=[^,]*,(.+)/i);
      if (jsonMatch) {
        const decoded = decodeURIComponent(jsonMatch[1]);
        metadata = JSON.parse(decoded);
        return buildAgentFromMetadata(agent, metadata);
      }

      // Try generic data URI parsing
      const genericMatch = uri.match(/data:[^;,]*;?(?:charset=[^,]*)?,(.+)/i);
      if (genericMatch) {
        try {
          const decoded = decodeURIComponent(genericMatch[1]);
          metadata = JSON.parse(decoded);
          return buildAgentFromMetadata(agent, metadata);
        } catch {
          // Not JSON, continue
        }
      }
    }

    // Case 4: IPFS URI - convert to HTTP gateway
    let fetchUrl = uri;
    if (uri.startsWith("ipfs://")) {
      const cid = uri.replace("ipfs://", "");
      // Use multiple IPFS gateways for reliability
      fetchUrl = `https://ipfs.io/ipfs/${cid}`;
    }

    // Case 5: HTTP/HTTPS URL - fetch the metadata
    if (fetchUrl.startsWith("http://") || fetchUrl.startsWith("https://")) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      try {
        const res = await fetch(fetchUrl, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "ERC8004-Indexer/1.0",
          },
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        // Try to parse as JSON
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json") || contentType.includes("text/")) {
          const text = await res.text();
          try {
            metadata = JSON.parse(text);
            return buildAgentFromMetadata(agent, metadata);
          } catch {
            // Response is not valid JSON
            return createDefaultAgent(agent, `Non-JSON response from ${fetchUrl}`);
          }
        }

        metadata = await res.json();
        return buildAgentFromMetadata(agent, metadata);
      } catch (fetchError) {
        clearTimeout(timeoutId);

        // Try alternative IPFS gateway if original URL was IPFS
        if (uri.startsWith("ipfs://")) {
          const cid = uri.replace("ipfs://", "");
          const alternativeGateways = [
            `https://gateway.pinata.cloud/ipfs/${cid}`,
            `https://cloudflare-ipfs.com/ipfs/${cid}`,
            `https://dweb.link/ipfs/${cid}`,
          ];

          for (const gateway of alternativeGateways) {
            try {
              const altRes = await fetch(gateway, {
                signal: AbortSignal.timeout(10000),
                headers: { Accept: "application/json" },
              });

              if (altRes.ok) {
                const text = await altRes.text();
                metadata = JSON.parse(text);
                return buildAgentFromMetadata(agent, metadata);
              }
            } catch {
              // Try next gateway
            }
          }
        }

        throw fetchError;
      }
    }

    // Case 6: Unknown format - try to parse as JSON first, then as URL
    if (isValidJson(uri)) {
      metadata = JSON.parse(uri);
      return buildAgentFromMetadata(agent, metadata);
    }

    // Fallback: Unknown URI format
    return createDefaultAgent(agent, `Unknown URI format: ${uri.substring(0, 50)}...`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Suppress common/expected errors (just log to debug level)
    const isExpectedError = 
      errorMessage.includes("404") ||
      errorMessage.includes("410") ||
      errorMessage.includes("504") ||
      errorMessage.includes("401") ||
      errorMessage.includes("403") ||
      errorMessage.includes("aborted") ||
      errorMessage.includes("timeout") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ENOTFOUND");
    
    // Only log unexpected errors
    if (!isExpectedError) {
      console.warn(
        `Failed to resolve metadata for agent ${agent.agentId} (${agent.chain}): ${errorMessage}`
      );
    }
    
    return createDefaultAgent(agent, errorMessage);
  }
}

/**
 * Create a default agent object when metadata cannot be resolved
 */
function createDefaultAgent(agent: Agent, reason: string): Agent {
  return {
    ...agent,
    name: `Agent ${agent.agentId}`,
    description: `Metadata unavailable: ${reason}`,
    capabilities: [],
    services: [],
    endpoint: "",
  };
}

/**
 * Build an Agent object from parsed metadata
 */
function buildAgentFromMetadata(agent: Agent, metadata: any): Agent {
  return {
    ...agent,
    name: metadata.name || metadata.displayName || metadata.username || `Agent ${agent.agentId}`,
    description: metadata.description || metadata.bio || metadata.about || "No description available",
    capabilities: metadata.capabilities || metadata.skills || [],
    services: metadata.services || [],
    endpoint: extractEndpoint(metadata),
  };
}

/**
 * Extract endpoint from metadata
 */
function extractEndpoint(metadata: any): string {
  // Check for services array with endpoints
  if (metadata.services && Array.isArray(metadata.services) && metadata.services.length > 0) {
    // Prefer web or A2A endpoints
    const preferred = metadata.services.find(
      (s: any) => s.name === "web" || s.name === "A2A"
    );
    if (preferred?.endpoint) return preferred.endpoint;
    // Fall back to first service endpoint
    if (metadata.services[0]?.endpoint) return metadata.services[0].endpoint;
  }

  // Check for direct endpoint or dispatchEndpoint
  return metadata.endpoint || metadata.dispatchEndpoint || "";
}

/**
 * Scan blocks in chunks to avoid RPC limitations
 */
async function scanBlocksInChunks(
  chain: (typeof CHAINS)[0],
  provider: ethers.JsonRpcProvider,
  registryAddress: string,
  fromBlock: number,
  toBlock: number,
  chunkSize: number
): Promise<ethers.Log[]> {
  const allLogs: ethers.Log[] = [];
  const contract = new ethers.Contract(registryAddress, ABI, provider);

  // Get the event topic for Registered event
  const registeredEventTopic = INTERFACE.getEvent("Registered")?.topicHash;

  if (!registeredEventTopic) {
    console.error(`Chain ${chain.name}: Failed to get Registered event topic`);
    return [];
  }

  console.log(`Chain ${chain.name}: Registered event topic: ${registeredEventTopic}`);

  let consecutiveErrors = 0;

  for (let start = fromBlock; start < toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize, toBlock);

    console.log(
      `Chain ${chain.name}: Scanning blocks ${start.toLocaleString()} to ${end.toLocaleString()}...`
    );

    try {
      // Method 1: Use contract.filters with queryFilter
      const filter = contract.filters.Registered();
      const chunkEvents = await contract.queryFilter(filter, start, end);

      if (chunkEvents.length > 0) {
        console.log(`Chain ${chain.name}: Found ${chunkEvents.length} Registered events in this chunk`);
        allLogs.push(...chunkEvents);
      }

      consecutiveErrors = 0; // Reset error counter on success

      // Rate limiting delay between chunks
      if (end < toBlock) {
        await new Promise((resolve) => setTimeout(resolve, DEFAULT_RATE_LIMIT_DELAY));
      }
    } catch (error: unknown) {
      consecutiveErrors++;

      // FIXED: Properly handle error object
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("pruned history") ||
        errorMessage.includes("missing trie node") ||
        errorMessage.includes("no backends available")
      ) {
        console.warn(`Chain ${chain.name}: Skipping problematic block range ${start}-${end}`);
        continue;
      }

      console.error(
        `Chain ${chain.name}: Error scanning chunk ${start}-${end}:`,
        errorMessage
      );

      // If too many consecutive errors, break to avoid infinite loop
      if (consecutiveErrors > 5) {
        console.error(`Chain ${chain.name}: Too many consecutive errors, stopping scan`);
        break;
      }

      // Add longer delay after error
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return allLogs;
}

/**
 * Discover agents from a single chain with chunked scanning
 */
async function discoverAgentsFromChain(chain: (typeof CHAINS)[0]): Promise<Agent[]> {
  try {
    console.log(`\nChain ${chain.name}: Starting discovery...`);

    const provider = await createProviderWithRetry(chain);
    if (!provider) {
      console.error(`Chain ${chain.name}: Failed to connect after ${MAX_RETRIES} attempts`);
      return [];
    }

    const registryAddress = getRegistryAddress(chain.isTestnet);
    console.log(`Chain ${chain.name}: Registry address: ${registryAddress}`);

    // Verify the contract exists by checking code
    const code = await provider.getCode(registryAddress);
    if (code === "0x") {
      console.error(`Chain ${chain.name}: No contract found at registry address ${registryAddress}`);
      return [];
    }
    console.log(`Chain ${chain.name}: Contract verified (${code.length} bytes)`);

    // Get the last indexed block for this chain
    const lastIndexedBlock = await getLastIndexedBlock(chain.name, provider);

    // Get the current block number
    const currentBlock = await provider.getBlockNumber();

    console.log(
      `Chain ${chain.name}: Current block: ${currentBlock.toLocaleString()}, Last indexed: ${lastIndexedBlock.toLocaleString()}`
    );

    // If we've already indexed up to the current block, skip
    if (lastIndexedBlock >= currentBlock) {
      console.log(
        `Chain ${chain.name}: Already indexed up to block ${currentBlock.toLocaleString()}`
      );
      return [];
    }

    console.log(
      `Chain ${chain.name}: Scanning ${(currentBlock - lastIndexedBlock).toLocaleString()} blocks in chunks of ${chain.blockChunkSize}`
    );

    // Scan in chunks
    const events = await scanBlocksInChunks(
      chain,
      provider,
      registryAddress,
      lastIndexedBlock,
      currentBlock,
      chain.blockChunkSize
    );

    console.log(`Chain ${chain.name}: Found ${events.length} total Registered events`);

    const agents: Agent[] = [];

    let skippedEmptyUri = 0;

    for (const event of events) {
      try {
        // FIXED: Parse the event log properly
        const parsedLog = INTERFACE.parseLog({
          topics: event.topics,
          data: event.data,
        });

        if (!parsedLog) {
          // This might be a Transfer event or other event, skip silently
          continue;
        }

        const agentId = parsedLog.args.agentId?.toString();
        const agentURI = parsedLog.args.agentURI;
        const owner = parsedLog.args.owner;

        // agentId is required, but agentURI can be empty (set later via setAgentURI)
        if (!agentId) {
          continue;
        }

        // Handle empty agentURI - agent registered without initial URI
        if (!agentURI || agentURI.trim() === "") {
          skippedEmptyUri++;
          // Still add the agent, but with placeholder URI
          const agent: Agent = {
            chain: chain.name,
            chainId: chain.chainId,
            agentId,
            owner: owner || "",
            agentURI: "",
            name: `Agent ${agentId}`,
            description: "No URI set - agent registered without metadata",
            capabilities: [],
            services: [],
            endpoint: "",
          };
          agents.push(agent);
          continue;
        }

        const agent: Agent = {
          chain: chain.name,
          chainId: chain.chainId,
          agentId,
          owner: owner || "",
          agentURI,
        };

        agents.push(agent);
      } catch (parseError) {
        // Silently skip unparseable events (could be other event types)
      }
    }

    if (skippedEmptyUri > 0) {
      console.log(`Chain ${chain.name}: ${skippedEmptyUri} agents registered without URI (will be added when URI is set)`);
    }

    console.log(`Chain ${chain.name}: Parsed ${agents.length} valid agents from events`);

    // Resolve metadata in parallel with concurrency limit
    // Filter out agents that already have resolved metadata (empty URI case)
    const agentsToResolve = agents.filter(a => a.agentURI && a.agentURI.trim() !== "");
    const agentsWithEmptyUri = agents.filter(a => !a.agentURI || a.agentURI.trim() === "");

    console.log(`Chain ${chain.name}: Resolving metadata for ${agentsToResolve.length} agents (${agentsWithEmptyUri.length} have no URI)`);

    const batchSize = 3; // Reduced batch size to avoid rate limiting
    const resolvedAgents: Agent[] = [...agentsWithEmptyUri]; // Include agents with empty URI
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < agentsToResolve.length; i += batchSize) {
      const batch = agentsToResolve.slice(i, i + batchSize);

      const resolvedBatch = await Promise.allSettled(
        batch.map((agentItem) => resolveAgentMetadata(agentItem))
      );

      for (let j = 0; j < resolvedBatch.length; j++) {
        const result = resolvedBatch[j];
        if (result.status === "fulfilled") {
          resolvedAgents.push(result.value);
          successCount++;
        } else {
          // Create a default agent for failed resolutions
          const failedAgent = batch[j];
          resolvedAgents.push({
            ...failedAgent,
            name: `Agent ${failedAgent.agentId}`,
            description: "Metadata resolution failed",
            capabilities: [],
            services: [],
            endpoint: "",
          });
          failCount++;
        }
      }

      // Progress logging every 100 agents
      if ((i + batchSize) % 100 < batchSize) {
        console.log(`Chain ${chain.name}: Resolved ${successCount + failCount}/${agentsToResolve.length} metadata...`);
      }

      // Longer delay between batches to avoid rate limiting
      if (i + batchSize < agentsToResolve.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`Chain ${chain.name}: Metadata resolution complete - ${successCount} succeeded, ${failCount} failed`);

    // Update the last indexed block
    await updateLastIndexedBlock(chain.name, currentBlock);

    return resolvedAgents;
  } catch (error) {
    console.error(
      `Error discovering agents from chain ${chain.name}:`,
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

/**
 * Discover agents from all chains in parallel with concurrency limit
 */
export async function discoverAgentsFromAllChains(): Promise<Agent[]> {
  console.log("\n🚀 Starting cross-chain ERC-8004 indexing...\n");

  const results = [];
  const concurrencyLimit = 2; // Process 2 chains at a time

  for (let i = 0; i < CHAINS.length; i += concurrencyLimit) {
    const batch = CHAINS.slice(i, i + concurrencyLimit);
    const batchResults = await Promise.allSettled(
      batch.map((chain) => discoverAgentsFromChain(chain))
    );

    results.push(...batchResults);

    // Delay between batches
    if (i + concurrencyLimit < CHAINS.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const agents = results
    .filter((r): r is PromiseFulfilledResult<Agent[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  console.log(`\n✅ Discovered ${agents.length} total agents across all chains`);

  return agents;
}

/**
 * Store agents in the database
 */
export async function storeAgents(agents: Agent[]): Promise<void> {
  if (agents.length === 0) return;

  console.log(`Storing ${agents.length} agents in database...`);

  let stored = 0;

  for (const agent of agents) {
    try {
      const chainInfo = CHAINS.find((c) => c.chainId === agent.chainId);
      const registryAddress = getRegistryAddress(chainInfo?.isTestnet || false);
      const agentId = `eip155:${agent.chainId}:${registryAddress}:${agent.agentId}`;

      await db.installedAgent.upsert({
        where: { agentId },
        update: {
          name: agent.name || `Agent ${agent.agentId}`,
          description: agent.description || "No description",
          capabilities: JSON.stringify(agent.capabilities || []),
          dispatchEndpoint: agent.endpoint || agent.agentURI,
          metadata: JSON.stringify({
            chain: agent.chain,
            chainId: agent.chainId,
            owner: agent.owner,
            agentURI: agent.agentURI,
          }),
          updatedAt: new Date(),
        },
        create: {
          agentId,
          name: agent.name || `Agent ${agent.agentId}`,
          description: agent.description || "No description",
          capabilities: JSON.stringify(agent.capabilities || []),
          dispatchEndpoint: agent.endpoint || agent.agentURI,
          installedBy: undefined,
          installedAt: new Date(),
          metadata: JSON.stringify({
            chain: agent.chain,
            chainId: agent.chainId,
            owner: agent.owner,
            agentURI: agent.agentURI,
          }),
        },
      });

      stored++;

      if (stored % 10 === 0) {
        console.log(`Stored ${stored}/${agents.length} agents...`);
      }
    } catch (error) {
      console.error(`Failed to store agent ${agent.agentId}:`, error);
    }
  }

  console.log(`✅ Stored ${stored} agents successfully`);
}

/**
 * Run the full indexing pipeline
 */
export async function indexAgents(): Promise<Agent[]> {
  const discovered = await discoverAgentsFromAllChains();

  if (discovered.length > 0) {
    await storeAgents(discovered);
  }

  console.log("✅ Indexing complete\n");

  return discovered;
}

/**
 * Get the global identifier for an agent
 */
export function getGlobalAgentId(
  chainId: number,
  registryAddress: string,
  agentId: string
): string {
  return `eip155:${chainId}:${registryAddress}:${agentId}`;
}

/**
 * Parse a global agent ID into its components
 */
export function parseGlobalAgentId(
  globalId: string
): {
  chainId: number;
  registryAddress: string;
  agentId: string;
} | null {
  const match = globalId.match(/^eip155:(\d+):(0x[a-fA-F0-9]+):(.+)$/);
  if (!match) return null;

  return {
    chainId: parseInt(match[1]),
    registryAddress: match[2],
    agentId: match[3],
  };
}

/**
 * Test connection to a specific chain's registry
 */
export async function testChainConnection(chainName: string): Promise<{
  success: boolean;
  blockNumber?: number;
  agentCount?: number;
  error?: string;
}> {
  const chain = CHAINS.find((c) => c.name === chainName);
  if (!chain) {
    return { success: false, error: `Chain ${chainName} not found` };
  }

  try {
    const provider = await createProviderWithRetry(chain);
    if (!provider) {
      return { success: false, error: "Failed to connect to provider" };
    }

    const blockNumber = await provider.getBlockNumber();
    const registryAddress = getRegistryAddress(chain.isTestnet);

    // Check if contract exists
    const code = await provider.getCode(registryAddress);
    if (code === "0x") {
      return {
        success: false,
        blockNumber,
        error: "No contract at registry address",
      };
    }

    // Try to get the current agent count by scanning recent blocks
    const contract = new ethers.Contract(registryAddress, ABI, provider);
    const filter = contract.filters.Registered();

    // Check last 1000 blocks for quick test
    const fromBlock = Math.max(0, blockNumber - 1000);
    const events = await contract.queryFilter(filter, fromBlock, blockNumber);

    return {
      success: true,
      blockNumber,
      agentCount: events.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
