"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

interface Agent {
  id: string;
  chainId?: string;
  tokenId?: string;
  name: string;
  description: string;
  capabilities: string[];
  protocols: string[];
  source: "local" | "erc8004" | "installed";
  isInstalled: boolean;
  rating: number;
  reviewCount: number;
  owner?: string;
  verified?: boolean;
  metadata?: {
    name?: string;
    description?: string;
    image?: string;
    capabilities?: string[];
    protocols?: string[];
  };
  createdAt?: string;
  updatedAt?: string;
  // Local agent specific fields
  criteria?: any;
  isOnline?: boolean;
  status?: string;
}

// Common capabilities from 8004scan API
const CAPABILITIES = [
  "All",
  "Research",
  "Analysis",
  "Code",
  "Data",
  "Trading",
  "DeFi",
  "NFT",
  "Gaming",
  "Social",
  "Infrastructure",
  "Security",
  "Analytics",
  "Automation",
  "General",
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCapability, setSelectedCapability] = useState("All");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch agents when search or filter changes
  useEffect(() => {
    fetchAgents();
  }, [debouncedSearch, selectedCapability]);

  const fetchAgents = async () => {
    setLoading(true);
    setError(null);

    try {
      // Use /api/agents endpoint which combines local + on-chain (ERC-8004) agents
      const params = new URLSearchParams();
      params.append("source", "all"); // Get both local and ChaosChain agents
      if (debouncedSearch) {
        params.append("query", debouncedSearch);
      }
      if (selectedCapability && selectedCapability !== "All") {
        params.append("capability", selectedCapability.toLowerCase());
      }
      params.append("limit", "50");

      const response = await fetch(`/api/agents?${params.toString()}`);
      const data = await response.json();

      if (data.success && data.data) {
        // Transform agents to our format - handle both local and on-chain
        const processedAgents = data.data.map((agent: any) => {
          // Handle local agents (from database)
          if (agent.source === 'local') {
            return {
              id: agent.id,
              chainId: agent.erc8004AgentId ? agent.erc8004AgentId.split(':')[1] : undefined,
              tokenId: agent.erc8004AgentId ? agent.erc8004AgentId.split(':')[2] : undefined,
              name: agent.name,
              description: agent.description || "",
              capabilities: typeof agent.capabilities === 'string' ? JSON.parse(agent.capabilities) : (agent.capabilities || []),
              protocols: typeof agent.endpoints === 'string' 
                ? JSON.parse(agent.endpoints).map((e: any) => e.protocol || 'https') 
                : (agent.endpoints?.map((e: any) => e.protocol) || []),
              source: "local" as const,
              isInstalled: false,
              rating: agent.averageRating || agent.reputationScore || 0,
              reviewCount: agent.totalTasks || 0,
              owner: agent.owner?.walletAddress,
              verified: false,
              metadata: {
                name: agent.name,
                description: agent.description,
                capabilities: typeof agent.capabilities === 'string' ? JSON.parse(agent.capabilities) : agent.capabilities,
                protocols: typeof agent.endpoints === 'string' ? JSON.parse(agent.endpoints).map((e: any) => e.protocol) : agent.endpoints?.map((e: any) => e.protocol),
              },
              criteria: agent.criteria,
              isOnline: agent.isOnline,
              status: agent.status,
              createdAt: agent.createdAt,
              updatedAt: agent.updatedAt,
            };
          }
          // Handle ERC-8004 agents (from ChaosChain)
          return {
            id: agent.id || `eip155:${agent.chainId}:${agent.tokenId}`,
            chainId: agent.chainId,
            tokenId: agent.tokenId,
            name: agent.name || "Unnamed Agent",
            description: agent.description || agent.metadata?.description || "",
            capabilities: agent.capabilities || agent.metadata?.capabilities || [],
            protocols: agent.protocols || agent.metadata?.protocols || [],
            source: "erc8004" as const,
            isInstalled: false,
            rating: agent.reputation?.averageRating || 0,
            reviewCount: agent.reputation?.totalRatings || 0,
            owner: agent.owner,
            verified: agent.verified || false,
            metadata: agent.metadata,
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
          };
        });
        setAgents(processedAgents);
      } else {
        setError(data.error || "Failed to fetch agents");
      }
    } catch (err) {
      console.error("Error fetching agents:", err);
      setError("Failed to fetch agents. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAgents();
  };

  const clearError = () => {
    setError(null);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Agent Marketplace</h1>
        <p className="text-gray-600 mb-6">
          Discover and install agents from the platform and ERC-8004 registry
        </p>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="flex gap-4">
          <input
            type="text"
            placeholder="Search agents by name, description, or capability..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Search
          </button>
        </form>

        {/* Capability Filter Chips */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {CAPABILITIES.map((cap) => (
            <button
              key={cap}
              onClick={() => setSelectedCapability(cap)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedCapability === cap
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              {cap}
            </button>
          ))}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex justify-between items-center">
            <p className="text-red-600">{error}</p>
            <button
              onClick={clearError}
              className="text-red-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Loading State with Skeletons */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-lg shadow-md p-6"
            >
              <Skeleton className="h-6 w-3/4 mb-4" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-2/3 mb-4" />
              <div className="flex gap-2 mb-4">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-6 w-16" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg mb-2">No agents found</p>
          <p className="text-gray-500 text-sm">
            Try adjusting your search or filters
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent, index) => (
            <div key={`${agent.id}-${index}`} className="block">
              <Link
                href={`/agents/${agent.id}`}
                className={`bg-white rounded-lg shadow-md hover:shadow-lg transition-all block h-full border-2 ${
                  agent.isInstalled 
                    ? 'border-green-300 hover:border-green-400' 
                    : agent.source === 'local'
                      ? 'border-purple-200 hover:border-purple-300'
                      : agent.verified 
                        ? 'border-blue-200 hover:border-blue-300'
                        : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                {/* Agent Image */}
                {agent.metadata?.image && (
                  <div className="h-32 overflow-hidden rounded-t-lg bg-gradient-to-br from-blue-50 to-indigo-50">
                    <img 
                      src={agent.metadata.image} 
                      alt={agent.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                
                <div className="p-5">
                  {/* Header with name and status */}
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-bold line-clamp-1 text-gray-900">
                      {agent.name}
                    </h3>
                    <div className="flex gap-1">
                      {agent.isInstalled && (
                        <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                          Installed
                        </span>
                      )}
                      {agent.source === 'local' && agent.status && (
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          agent.status === 'ACTIVE' 
                            ? agent.isOnline 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-yellow-100 text-yellow-800'
                            : agent.status === 'OFFLINE'
                              ? 'bg-gray-100 text-gray-800'
                              : 'bg-red-100 text-red-800'
                        }`}>
                          {agent.status === 'ACTIVE' 
                            ? (agent.isOnline ? 'Online' : 'Idle')
                            : agent.status
                          }
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Chain and Token ID */}
                  {agent.chainId && agent.tokenId && (
                    <div className="mb-3 text-xs font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded">
                      Chain: {agent.chainId} | Token: #{agent.tokenId}
                    </div>
                  )}

                  {/* Description */}
                  <p className="text-gray-600 mb-4 line-clamp-2 text-sm">
                    {agent.description}
                  </p>

                  {/* Protocol Badges */}
                  {agent.protocols && agent.protocols.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {agent.protocols.slice(0, 4).map((protocol) => (
                        <span
                          key={protocol}
                          className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            protocol.toLowerCase() === 'mcp' 
                              ? 'bg-purple-100 text-purple-700' 
                              : protocol.toLowerCase() === 'a2a'
                                ? 'bg-blue-100 text-blue-700'
                                : protocol.toLowerCase() === 'http' || protocol.toLowerCase() === 'web'
                                  ? 'bg-green-100 text-green-700'
                                  : protocol.toLowerCase() === 'email'
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {protocol.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Capabilities */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {agent.capabilities?.slice(0, 3).map((cap) => (
                      <span
                        key={cap}
                        className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded"
                      >
                        {cap}
                      </span>
                    ))}
                    {agent.capabilities?.length > 3 && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                        +{agent.capabilities.length - 3}
                      </span>
                    )}
                  </div>

                  {/* Owner Address */}
                  {agent.owner && (
                    <div className="mb-3 text-xs text-gray-500">
                      <span className="font-medium">Owner:</span>{' '}
                      <span className="font-mono bg-gray-50 px1 py-0.5 rounded">
                        {agent.owner.slice(0, 6)}...{agent.owner.slice(-4)}
                      </span>
                    </div>
                  )}

                  {/* Footer with rating and source */}
                  <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                    {/* Star Rating */}
                    <div className="flex items-center gap-1">
                      <div className="flex">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <span key={star} className="text-sm">
                            {star <= Math.round(agent.rating) ? (
                              <span className="text-yellow-400">★</span>
                            ) : (
                              <span className="text-gray-300">★</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <span className="text-sm font-semibold text-gray-700">
                        {agent.rating > 0 ? agent.rating.toFixed(1) : 'N/A'}
                      </span>
                      {agent.reviewCount > 0 && (
                        <span className="text-xs text-gray-400">
                          ({agent.reviewCount})
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {/* Source badge */}
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        agent.source === 'local' 
                          ? 'bg-purple-50 text-purple-600' 
                          : agent.source === 'erc8004'
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-green-50 text-green-600'
                      }`}>
                        {agent.source === 'local' ? 'Platform' : agent.source === 'erc8004' ? 'ERC-8004' : agent.source}
                      </span>
                      
                      {/* Verified badge */}
                      {agent.verified && (
                        <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">
                          ✓ Verified
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Created Date */}
                  {agent.createdAt && (
                    <div className="mt-3 text-xs text-gray-400">
                      Created: {new Date(agent.createdAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
