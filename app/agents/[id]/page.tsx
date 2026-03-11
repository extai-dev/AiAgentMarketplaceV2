'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'

interface Agent {
  id: string
  chainId?: string
  tokenId?: string
  name: string
  description: string
  capabilities: string[]
  protocols: string[]
  dispatchEndpoint?: string
  source: 'local' | 'erc8004' | 'installed'
  installedBy?: string
  installedAt?: string
  verified: boolean
  metadata?: any
  owner?: string
}

interface Review {
  id: string
  user: string
  rating: number
  comment: string
  createdAt: string
}

/**
 * Parse agent ID to extract chainId and tokenId
 * Format: eip155:{chainId}:{tokenId} or plain number
 */
function parseAgentId(id: string): { chainId: string; tokenId: string } | null {
  // Try to match eip155 format: eip155:1:123
  const match = id.match(/^eip155:(\d+):(\d+)$/)
  if (match) {
    return { chainId: match[1], tokenId: match[2] }
  }
  
  // Try as plain number (backward compatibility)
  const num = parseInt(id)
  if (!isNaN(num)) {
    return { chainId: '1', tokenId: id } // Default to chain 1
  }
  
  return null
}

export default function AgentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [newRating, setNewRating] = useState(0)
  const [newComment, setNewComment] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)

  useEffect(() => {
    if (params.id) {
      fetchAgent()
      fetchReviews()
    }
  }, [params.id])

  const fetchAgent = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const agentId = params.id as string
      const parsed = parseAgentId(agentId)
      
      if (parsed) {
        // Fetch from 8004scan API
        const response = await fetch(`/api/8004scan/agents/${parsed.chainId}/${parsed.tokenId}`)
        const data = await response.json()
        
        if (data.success && data.data) {
          const agentData = data.data
          setAgent({
            id: agentId,
            chainId: agentData.chainId,
            tokenId: agentData.tokenId,
            name: agentData.name || 'Unnamed Agent',
            description: agentData.description || agentData.metadata?.description || '',
            capabilities: agentData.capabilities || agentData.metadata?.capabilities || [],
            protocols: agentData.protocols || agentData.metadata?.protocols || [],
            dispatchEndpoint: agentData.uri,
            source: 'erc8004',
            verified: agentData.verified || false,
            metadata: agentData.metadata,
            owner: agentData.owner,
          })
        } else {
          // Try fallback to agent-store
          await fetchAgentFallback(agentId)
        }
      } else {
        // Invalid ID format, try fallback
        await fetchAgentFallback(agentId)
      }
    } catch (err) {
      console.error('Error fetching agent:', err)
      // Try fallback
      const fallbackId = params.id as string
      await fetchAgentFallback(fallbackId)
    } finally {
      setLoading(false)
    }
  }

  const fetchAgentFallback = async (agentId: string) => {
    try {
      const response = await fetch(`/api/agent-store?userId=test-user-${agentId}`)
      const data = await response.json()

      if (data.success && data.data.length > 0) {
        const agentData = data.data[0]
        setAgent(agentData.agent)
        setIsInstalled(agentData.isInstalled)
      } else {
        setError('Agent not found')
      }
    } catch (err) {
      console.error('Error fetching agent from fallback:', err)
      setError('Failed to load agent')
    }
  }

  const fetchReviews = async () => {
    const agentId = params.id as string
    try {
      const parsed = parseAgentId(agentId)
      
      if (parsed) {
        // Fetch from 8004scan feedbacks API
        const response = await fetch(`/api/8004scan/feedbacks?chainId=${parsed.chainId}&tokenId=${parsed.tokenId}`)
        const data = await response.json()
        
        if (data.success && data.data) {
          const feedbacks = data.data.map((fb: any) => ({
            id: fb.id,
            user: fb.user || 'Anonymous',
            rating: fb.rating,
            comment: fb.comment,
            createdAt: fb.createdAt,
          }))
          setReviews(feedbacks)
          return
        }
      }
      
      // Fallback to agent-store reviews
      await fetchReviewsFallback(agentId)
    } catch (err) {
      console.error('Error fetching reviews:', err)
      await fetchReviewsFallback(agentId)
    }
  }

  const fetchReviewsFallback = async (agentId: string) => {
    try {
      const response = await fetch(`/api/agent-store/reviews?agentId=${agentId}`)
      const data = await response.json()

      if (data.success) {
        setReviews(data.data)
      }
    } catch (err) {
      console.error('Error fetching reviews from fallback:', err)
    }
  }

  const handleInstall = async () => {
    try {
      const response = await fetch('/api/agent-store/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: params.id,
          userId: 'test-user',
        }),
      })

      const data = await response.json()

      if (data.success) {
        setIsInstalled(true)
        alert('Agent installed successfully!')
      }
    } catch (error) {
      console.error('Error installing agent:', error)
    }
  }

  const handleUninstall = async () => {
    if (!confirm('Are you sure you want to uninstall this agent?')) {
      return
    }

    try {
      const response = await fetch(`/api/agent-store/installed/${params.id}?userId=test-user`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (data.success) {
        setIsInstalled(false)
        alert('Agent uninstalled successfully!')
      }
    } catch (error) {
      console.error('Error uninstalling agent:', error)
    }
  }

  const handleSubmitReview = async () => {
    if (newRating === 0) {
      alert('Please select a rating')
      return
    }

    setSubmittingReview(true)

    try {
      const response = await fetch('/api/agent-store/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: params.id,
          userId: 'test-user',
          userName: 'Test User',
          rating: newRating,
          comment: newComment,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setNewRating(0)
        setNewComment('')
        fetchReviews()
        alert('Review submitted successfully!')
      }
    } catch (error) {
      console.error('Error submitting review:', error)
    } finally {
      setSubmittingReview(false)
    }
  }

  // Loading state with skeletons
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <button
          onClick={() => router.back()}
          className="mb-4 text-blue-600 hover:text-blue-800"
        >
          ← Back to Agents
        </button>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <Skeleton className="h-10 w-1/2 mb-4" />
          <Skeleton className="h-6 w-1/3 mb-6" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4 mb-6" />
          <Skeleton className="h-6 w-full mb-4" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !agent) {
    return (
      <div className="container mx-auto px-4 py-8">
        <button
          onClick={() => router.back()}
          className="mb-4 text-blue-600 hover:text-blue-800"
        >
          ← Back to Agents
        </button>
        
        <div className="bg-white rounded-lg shadow-md p-6">
          <p className="text-gray-600 text-lg">
            {error || 'Agent not found'}
          </p>
        </div>
      </div>
    )
  }

  const averageRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0

  return (
    <div className="container mx-auto px-4 py-8">
      <button
        onClick={() => router.back()}
        className="mb-4 text-blue-600 hover:text-blue-800"
      >
        ← Back to Agents
      </button>

      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">{agent.name}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-yellow-500">★</span>
              <span className="font-semibold">{averageRating.toFixed(1)}</span>
              <span className="text-gray-500">({reviews.length} reviews)</span>
              {agent.verified && (
                <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-sm rounded">
                  Verified
                </span>
              )}
              <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded">
                {agent.source}
              </span>
            </div>
            
            {/* Chain and Token ID info */}
            {agent.chainId && agent.tokenId && (
              <div className="mt-2 text-sm text-gray-500">
                Chain ID: {agent.chainId} | Token ID: {agent.tokenId}
              </div>
            )}
            
            {/* Owner info */}
            {agent.owner && (
              <div className="mt-1 text-sm text-gray-500">
                Owner: <span className="font-mono">{agent.owner.slice(0, 6)}...{agent.owner.slice(-4)}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {!isInstalled ? (
              <button
                onClick={handleInstall}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Install Agent
              </button>
            ) : (
              <button
                onClick={handleUninstall}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Uninstall
              </button>
            )}
          </div>
        </div>

        <p className="text-gray-600 mb-6">{agent.description}</p>

        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-3">Capabilities</h2>
          <div className="flex flex-wrap gap-2">
            {agent.capabilities.length > 0 ? (
              agent.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="px-3 py-1 bg-blue-100 text-blue-800 rounded-lg"
                >
                  {cap}
                </span>
              ))
            ) : (
              <span className="text-gray-500">No capabilities specified</span>
            )}
          </div>
        </div>

        {agent.protocols.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-3">Protocols</h2>
            <div className="flex flex-wrap gap-2">
              {agent.protocols.map((protocol) => (
                <span
                  key={protocol}
                  className="px-3 py-1 bg-gray-100 text-gray-800 rounded-lg"
                >
                  {protocol}
                </span>
              ))}
            </div>
          </div>
        )}

        {agent.dispatchEndpoint && (
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-3">Dispatch Endpoint</h2>
            <p className="text-gray-600 font-mono text-sm break-all">
              {agent.dispatchEndpoint}
            </p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-semibold mb-6">Reviews</h2>

        {reviews.length === 0 ? (
          <p className="text-gray-600">No reviews yet. Be the first to review!</p>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <div key={review.id} className="border-b pb-4">
                <div className="flex justify-between2">
                   items-start mb-<div>
                    <p className="font-semibold">{review.user}</p>
                    <div className="flex items-center gap-1">
                      <span className="text-yellow-500">★</span>
                      <span className="font-semibold">{review.rating}</span>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500">
                    {review.createdAt ? new Date(review.createdAt).toLocaleDateString() : 'Unknown'}
                  </span>
                </div>
                {review.comment && (
                  <p className="text-gray-600">{review.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 pt-6 border-t">
          <h3 className="text-xl font-semibold mb-4">Write a Review</h3>
          <div className="flex gap-2 mb-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setNewRating(star)}
                className={`text-2xl ${
                  star <= newRating ? 'text-yellow-500' : 'text-gray-300'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Share your experience with this agent..."
            className="w-full px-4 py-2 border rounded-lg mb-4"
            rows={4}
          />
          <button
            onClick={handleSubmitReview}
            disabled={submittingReview}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            {submittingReview ? 'Submitting...' : 'Submit Review'}
          </button>
        </div>
      </div>
    </div>
  )
}
