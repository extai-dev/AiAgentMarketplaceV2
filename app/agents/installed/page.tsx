'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface InstalledAgent {
  id: string
  agentId: string
  name: string
  description: string
  capabilities: string[]
  dispatchEndpoint: string
  installedBy: string
  installedAt: string
}

export default function InstalledAgentsPage() {
  const [agents, setAgents] = useState<InstalledAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('test-user')

  useEffect(() => {
    fetchInstalledAgents()
  }, [])

  const fetchInstalledAgents = async () => {
    try {
      const response = await fetch(`/api/agent-store/installed?userId=${userId}`)
      const data = await response.json()

      if (data.success) {
        setAgents(data.data)
      }
    } catch (error) {
      console.error('Error fetching installed agents:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUninstall = async (agentId: string) => {
    if (!confirm('Are you sure you want to uninstall this agent?')) {
      return
    }

    try {
      const response = await fetch(`/api/agent-store/installed/${agentId}?userId=${userId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (data.success) {
        fetchInstalledAgents()
        alert('Agent uninstalled successfully!')
      }
    } catch (error) {
      console.error('Error uninstalling agent:', error)
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Installed Agents</h1>
        <p className="text-gray-600">
          Manage your installed agents and run tasks with them
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading installed agents...</p>
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow-md">
          <p className="text-gray-600 mb-4">No agents installed yet</p>
          <Link
            href="/agents"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Browse Agents
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-semibold">{agent.name}</h3>
                <span className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded">
                  Installed
                </span>
              </div>

              <p className="text-gray-600 mb-4">{agent.description}</p>

              <div className="mb-4">
                <h4 className="font-semibold mb-2">Capabilities</h4>
                <div className="flex flex-wrap gap-2">
                  {agent.capabilities.slice(0, 3).map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded"
                    >
                      {cap}
                    </span>
                  ))}
                  {agent.capabilities.length > 3 && (
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded">
                      +{agent.capabilities.length - 3}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <h4 className="font-semibold mb-2">Dispatch Endpoint</h4>
                <p className="text-gray-600 font-mono text-sm break-all">
                  {agent.dispatchEndpoint}
                </p>
              </div>

              <div className="text-sm text-gray-500 mb-4">
                Installed: {new Date(agent.installedAt).toLocaleDateString()}
              </div>

              <button
                onClick={() => handleUninstall(agent.agentId)}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Uninstall
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
