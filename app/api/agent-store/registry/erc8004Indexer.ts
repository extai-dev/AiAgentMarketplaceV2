/**
 * ERC-8004 Indexer Service
 * Scans ERC-8004 registry events and stores agents in database
 * This is the recommended approach per ERC-8004 spec
 */

import { ethers } from 'ethers'
import { db } from '@/lib/db'
import { ERC8004_REGISTRY_ADDRESS } from '@/lib/contracts/addresses'

const ERC8004_REGISTRY_ABI = [
  'function totalSupply() external view returns (uint256)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function isApprovedForAll(address owner, address operator) external view returns (bool)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
]

export interface IndexerConfig {
  chainId: number
  rpcUrl: string
  registryAddress: string
  fromBlock?: number
  batchSize?: number
}

export class ERC8004Indexer {
  private provider: ethers.JsonRpcProvider
  private registry: ethers.Contract
  private config: IndexerConfig

  constructor(config: IndexerConfig) {
    this.config = config
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl)
    this.registry = new ethers.Contract(
      config.registryAddress,
      ERC8004_REGISTRY_ABI,
      this.provider
    )
  }

  /**
   * Scan registry for new agents and store in database
   */
  async scanAndStore(): Promise<number> {
    try {
      const currentBlock = await this.provider.getBlockNumber()
      const fromBlock = this.config.fromBlock || Math.max(0, currentBlock - 10000)
      
      console.log(`Scanning ERC-8004 registry from block ${fromBlock} to ${currentBlock}`)

      // Query for Registered events
      const filter = this.registry.filters.Registered()
      const events = await this.registry.queryFilter(filter, fromBlock, currentBlock)

      let newAgentsCount = 0

      for (const event of events) {
        try {
          // Decode the event log
          const decoded = this.registry.interface.parseLog({
            topics: event.topics,
            data: event.data,
          })

          if (!decoded) continue

          const agentId = Number(decoded.args.agentId)
          const agentURI = decoded.args.agentURI
          const owner = decoded.args.owner

          // Check if agent already exists in database
          const existingAgent = await db.installedAgent.findUnique({
            where: { agentId: `erc8004:${this.config.chainId}:${agentId}` },
          })

          if (existingAgent) {
            continue // Agent already indexed
          }

          // Fetch agent metadata
          const metadata = await this.fetchAgentMetadata(agentURI)
          if (!metadata) continue

          // Store agent in database
          await db.installedAgent.create({
            data: {
              agentId: `erc8004:${this.config.chainId}:${agentId}`,
              name: metadata.name || `Agent ${agentId}`,
              description: metadata.description || '',
              capabilities: JSON.stringify(metadata.capabilities || []),
              dispatchEndpoint: metadata.services?.[0]?.endpoint || '',
              installedBy: owner,
              installedAt: new Date(),
              metadata: JSON.stringify(metadata),
            },
          })

          newAgentsCount++
          console.log(`Indexed agent ${agentId}: ${metadata.name}`)
        } catch (error) {
          console.error('Error processing event:', error)
          continue
        }
      }

      console.log(`Indexed ${newAgentsCount} new agents from ERC-8004 registry`)
      return newAgentsCount
    } catch (error) {
      console.error('Error scanning ERC-8004 registry:', error)
      throw error
    }
  }

  /**
   * Fetch agent metadata from URI
   */
  private async fetchAgentMetadata(uri: string): Promise<any> {
    try {
      // Handle IPFS URIs
      let fetchUrl = uri
      if (uri.startsWith('ipfs://')) {
        fetchUrl = `https://ipfs.io/ipfs/${uri.replace('ipfs://', '')}`
      } else if (uri.startsWith('data:application/json;base64,')) {
        const base64Data = uri.split(',')[1]
        const json = Buffer.from(base64Data, 'base64').toString('utf-8')
        return JSON.parse(json)
      }

      const response = await fetch(fetchUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Error fetching metadata:', error)
      return null
    }
  }
}

/**
 * Create indexer instance for Polygon Amoy testnet
 */
export function createAmoyIndexer(): ERC8004Indexer {
  return new ERC8004Indexer({
    chainId: 80002,
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc-amoy.polygon.technology',
    registryAddress: ERC8004_REGISTRY_ADDRESS,
    fromBlock: 0, // Start from genesis
  })
}
