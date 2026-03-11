/**
 * ChaosChain React Hook
 * 
 * Provides easy access to ChaosChain SDK functionality from React components
 */

'use client';

import { useState, useCallback } from 'react';

interface Agent {
  id: string;
  chainId: string;
  tokenId: string;
  name: string;
  description: string;
  owner: string;
  uri?: string;
  metadata?: any;
  verified: boolean;
  reputation?: {
    totalRatings: number;
    averageRating: number;
    ratings: any[];
  };
}

interface PaymentRequirements {
  amount: string;
  currency: string;
  merchant: string;
  resource: string;
  description: string;
  expiresAt: number;
}

interface SearchParams {
  query?: string;
  capabilities?: string[];
  protocols?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Hook for searching agents via ChaosChain
 */
export function useChaosChainSearch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);

  const search = useCallback(async (params: SearchParams) => {
    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams();
      if (params.query) queryParams.set('query', params.query);
      if (params.capabilities?.length) {
        queryParams.set('capabilities', params.capabilities.join(','));
      }
      if (params.protocols?.length) {
        queryParams.set('protocols', params.protocols.join(','));
      }
      queryParams.set('limit', String(params.limit || 20));
      queryParams.set('offset', String(params.offset || 0));

      const response = await fetch(`/api/chaoschain/search?${queryParams}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Search failed');
      }

      setAgents(data.data);
      setTotal(data.meta?.total || 0);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setAgents([]);
    setTotal(0);
    setError(null);
  }, []);

  return {
    agents,
    total,
    loading,
    error,
    search,
    clear,
  };
}

/**
 * Hook for getting agent details via ChaosChain
 */
export function useChaosChainAgent(agentId: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);

  const fetchAgent = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      // Parse agent ID to get chainId and tokenId
      const match = id.match(/^eip155:(\d+):(\d+)$/);
      if (!match) {
        throw new Error('Invalid agent ID format');
      }

      const chainId = match[1];
      const tokenId = match[2];

      const response = await fetch(`/api/chaoschain/agents/${chainId}/${tokenId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch agent');
      }

      setAgent(data.data);
      return data.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch agent';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch agent when ID changes
  useState(() => {
    if (agentId) {
      fetchAgent(agentId);
    }
  });

  return {
    agent,
    loading,
    error,
    fetchAgent,
  };
}

/**
 * Hook for payments using x402 protocol
 */
export function useChaosChainPayments() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Create a payment request for an agent
   */
  const createPaymentRequest = useCallback(async (params: {
    agentAddress: string;
    amount: string | number;
    resource: string;
    description?: string;
  }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          ...params,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create payment request');
      }

      return data.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment request failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Settle a payment using EIP-3009 authorization
   */
  const settlePayment = useCallback(async (params: {
    from: string;
    paymentRequirements: PaymentRequirements;
    authorization: string;
    agentId?: string;
    rating?: number;
    comment?: string;
    submitFeedback?: boolean;
  }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'settle',
          ...params,
        }),
      });

      const data = await response.json();

      if (!data.success && !data.transactionHash) {
        throw new Error(data.error || 'Payment settlement failed');
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment settlement failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Submit feedback for an agent after payment
   */
  const submitFeedback = useCallback(async (params: {
    agentId: string;
    rating: number;
    comment?: string;
    transactionHash: string;
    amount?: string;
  }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'feedback',
          agentId: params.agentId,
          rating: params.rating,
          comment: params.comment,
          proofOfPayment: {
            transactionHash: params.transactionHash,
            amount: params.amount || '0',
          },
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to submit feedback');
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Feedback submission failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Get payment status by transaction hash
   */
  const getPaymentStatus = useCallback(async (transactionHash: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          transactionHash,
        }),
      });

      const data = await response.json();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get payment status';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Get chain configuration
   */
  const getConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/payments?action=config');
      const data = await response.json();
      return data.config;
    } catch (err) {
      console.error('Failed to get config:', err);
      return null;
    }
  }, []);

  return {
    loading,
    error,
    createPaymentRequest,
    settlePayment,
    submitFeedback,
    getPaymentStatus,
    getConfig,
  };
}

/**
 * Hook for registering new ERC-8004 agents
 */
export function useChaosChainRegistration() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registerAgent = useCallback(async (params: {
    ownerAddress: string;
    metadata: {
      name: string;
      description: string;
      capabilities?: string[];
      protocols?: string[];
      version?: string;
      author?: string;
      homepage?: string;
      repository?: string;
      license?: string;
      icon?: string;
      tags?: string[];
      pricing?: {
        type: 'free' | 'paid' | 'subscription';
        cost?: string;
        currency?: string;
      };
    };
    services: Array<{
      endpoint: string;
      protocol: string;
    }>;
  }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chaoschain/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to register agent');
      }

      return data.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    registerAgent,
  };
}
