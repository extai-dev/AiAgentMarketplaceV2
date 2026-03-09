/**
 * Agent Store Types
 * Core type definitions for the ERC-8004 Agent App Store
 */

/**
 * ERC-8004 Agent Card Metadata
 * Normalized format from ERC-8004 standard
 */
export interface ERC8004AgentCard {
  name: string
  description: string
  services?: Array<{
    name: string
    endpoint: string
    protocol?: string
  }>
  endpoints?: Array<{
    name: string
    endpoint: string
    protocol?: string
  }>
  capabilities?: string[]
  protocols?: string[]
  version?: string
  author?: string
  homepage?: string
  repository?: string
  license?: string
  icon?: string
  tags?: string[]
  pricing?: {
    type?: string
    cost?: string
    currency?: string
  }
}

/**
 * Platform Agent - Normalized internal format
 * Used for internal platform operations
 */
export interface PlatformAgent {
  id: string
  name: string
  description: string
  capabilities: string[]
  protocols: string[]
  dispatchEndpoint: string
  source: 'local' | 'erc8004' | 'installed'
  installedBy?: string
  installedAt?: Date
  metadata?: ERC8004AgentCard
  verified: boolean
  reputation?: {
    score: number
    totalRatings: number
    reviews: AgentReview[]
  }
}

/**
 * Installed Agent in user's workspace
 */
export interface InstalledAgent {
  id: string
  agentId: string
  name: string
  description: string
  capabilities: string[]
  dispatchEndpoint: string
  installedBy: string
  installedAt: Date
  metadata?: ERC8004AgentCard
}

/**
 * Agent Review
 */
export interface AgentReview {
  id: string
  agentId: string
  userId: string
  userName: string
  rating: number
  comment?: string
  createdAt: Date
}

/**
 * Agent Search Filters
 */
export interface AgentSearchFilters {
  capability?: string
  name?: string
  protocol?: string
  minRating?: number
  source?: 'local' | 'erc8004' | 'installed'
  installedBy?: string
  tags?: string[]
}

/**
 * Agent Search Result
 */
export interface AgentSearchResult {
  agent: PlatformAgent
  isInstalled: boolean
  rating: number
  reviewCount: number
}

/**
 * Task for agent execution
 */
export interface AgentTask {
  id: string
  type: string
  payload: Record<string, any>
  metadata?: Record<string, any>
}

/**
 * Agent Execution Response
 */
export interface AgentExecutionResponse {
  success: boolean
  result?: any
  error?: string
  executionTime?: number
  metadata?: Record<string, any>
}

/**
 * ERC-8004 Registry Interface
 * Abstraction for ERC-8004 identity registry
 */
export interface ERC8004Registry {
  totalSupply(): Promise<bigint>
  tokenURI(tokenId: bigint): Promise<string>
  ownerOf(tokenId: bigint): Promise<string>
  isApprovedForAll(owner: string, operator: string): Promise<boolean>
}

/**
 * Verification Result
 */
export interface VerificationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  metadata?: ERC8004AgentCard
}
