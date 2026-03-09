'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface Agent {
  id: string
  name: string
  description: string
  capabilities: string[]
  protocols: string[]
  dispatchEndpoint: string
  source: 'local' | 'erc8004' | 'installed'
  installedBy?: string
  installedAt?: string
  verified: boolean
  metadata?: any
}

interface Review {
  id: string
  userName: string
  rating: number
  comment: string
  createdAt: string
}

export default function AgentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
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
    try {
      const response = await fetch(`/api/agent-store?userId=test-user-${params.id}`)
      const data = await response.json()

      if (data.success && data.data.length > 0) {
        const agentData = data.data[0]
        setAgent(agentData.agent)
        setIsInstalled(agentData.isInstalled)
      }
    } catch (error) {
      console.error('Error fetching agent:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchReviews = async () => {
    try {
      const response = await fetch(`/api/agent-store/reviews?agentId=${params.id}`)
      const data = await response.json()

      if (data.success) {
        setReviews(data.data)
      }
    } catch (error) {
      console.error('Error fetching reviews:', error)
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

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading agent...</p>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-gray-600">Agent not found</p>
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
            <div className="flex items-center gap-2">
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
            {agent.capabilities.map((cap) => (
              <span
                key={cap}
                className="px-3 py-1 bg-blue-100 text-blue-800 rounded-lg"
              >
                {cap}
              </span>
            ))}
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
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold">{review.userName}</p>
                    <div className="flex items-center gap-1">
                      <span className="text-yellow-500">★</span>
                      <span className="font-semibold">{review.rating}</span>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500">
                    {new Date(review.createdAt).toLocaleDateString()}
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
