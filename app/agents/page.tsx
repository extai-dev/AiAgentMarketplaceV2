"use client";

import { useEffect, useState, Fragment } from "react";
import Link from "next/link";

interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  source: "local" | "erc8004" | "installed";
  isInstalled: boolean;
  rating: number;
  reviewCount: number;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCapability, setSelectedCapability] = useState("");

  const capabilities = [
    "All",
    "Research",
    "Analysis",
    "Code",
    "Data",
    "General",
  ];

  useEffect(() => {
    fetchAgents();
  }, [searchTerm, selectedCapability]); // Add dependencies

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append("name", searchTerm);
      if (selectedCapability && selectedCapability !== "All") {
        params.append("capability", selectedCapability.toLowerCase());
      }

      const response = await fetch(`/api/agent-store?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        // Ensure each agent has required fields
        const processedAgents = data.data.map((agent: any) => ({
          ...agent,
          capabilities: agent.capabilities || [],
          rating: agent.rating || 0,
          reviewCount: agent.reviewCount || 0,
          source: agent.source || "erc8004",
        }));
        setAgents(processedAgents);
      }
    } catch (error) {
      console.error("Error fetching agents:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAgents();
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Agent Marketplace</h1>
        <p className="text-gray-600 mb-6">
          Discover and install ERC-8004 agents from the global registry
        </p>

        <form onSubmit={handleSearch} className="flex gap-4">
          <input
            type="text"
            placeholder="Search agents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-4 py-2 border rounded-lg"
          />
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Search
          </button>
        </form>

        <div className="flex gap-2 mt-4">
          {capabilities.map((cap) => (
            <button
              key={cap}
              onClick={() => setSelectedCapability(cap)}
              className={`px-4 py-2 rounded-lg ${
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

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading agents...</p>
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-600">No agents found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent, index) => (
            <div key={`${agent.id}-${index}`} className="block">
              <Link
                href={`/agents/${agent.id}`}
                className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow block"
              >
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-xl font-semibold">{agent.name}</h3>
                  {agent.isInstalled && (
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded">
                      Installed
                    </span>
                  )}
                </div>

                <p className="text-gray-600 mb-4">{agent.description}</p>

                <div className="flex flex-wrap gap-2 mb-4">
                  {agent.capabilities?.slice(0, 3).map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded"
                    >
                      {cap}
                    </span>
                  ))}
                  {agent.capabilities?.length > 3 && (
                    <span className="px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded">
                      +{agent.capabilities.length - 3}
                    </span>
                  )}
                </div>

                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1">
                    <span className="text-yellow-500">★</span>
                    <span className="font-semibold">
                      {agent.rating.toFixed(1)}
                    </span>
                    <span className="text-gray-500">({agent.reviewCount})</span>
                  </div>
                  <span className="text-sm text-gray-500 capitalize">
                    {agent.source}
                  </span>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
