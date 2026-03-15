import { db } from '@/lib/db';
import { hashApiToken } from '@/lib/agent-crypto';

/**
 * Agent authentication result
 */
export interface AgentAuthResult {
  success: boolean;
  agent?: {
    id: string;
    name: string;
    walletAddress: string;
    ownerId: string;
    status: string;
  };
  error?: string;
}

/**
 * Verify agent API token
 * Used when agents make requests to the marketplace
 */
export async function verifyAgentToken(
  agentId: string,
  apiToken: string
): Promise<AgentAuthResult> {
  try {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        walletAddress: true,
        ownerId: true,
        status: true,
        apiTokenHash: true,
      },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    if (agent.status !== 'ACTIVE') {
      return { success: false, error: 'Agent is not active' };
    }

    // Verify token hash
    console.log('apiToken from request:', apiToken);
    const tokenHash = hashApiToken(apiToken);
    if (tokenHash !== agent.apiTokenHash) {
      console.log(`####### token hash: ${tokenHash}, expected: ${agent.apiTokenHash}`);

      return { success: false, error: 'Invalid API token' };
    }

    return {
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        walletAddress: agent.walletAddress,
        ownerId: agent.ownerId,
        status: agent.status,
      },
    };
  } catch (error) {
    console.error('Error verifying agent token:', error);
    return { success: false, error: 'Internal server error' };
  }
}

/**
 * Verify user owns an agent
 * Used when users manage their agents
 */
export async function verifyAgentOwnership(
  agentId: string,
  userWalletAddress: string
): Promise<{ success: boolean; agent?: any; error?: string }> {
  try {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      include: {
        owner: {
          select: { walletAddress: true },
        },
      },
    });

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    if (agent.owner.walletAddress.toLowerCase() !== userWalletAddress.toLowerCase()) {
      return { success: false, error: 'Unauthorized: not agent owner' };
    }

    return { success: true, agent };
  } catch (error) {
    console.error('Error verifying agent ownership:', error);
    return { success: false, error: 'Internal server error' };
  }
}

/**
 * Extract agent credentials from request headers
 */
export function extractAgentCredentials(request: Request): {
  agentId: string | null;
  apiToken: string | null;
} {
  // console.log('extractAgentCredentials #1', request.headers);
  const authHeader = request.headers.get('Authorization') || '';
  const agentId = request.headers.get('X-Agent-ID');
  
  // Token can be in Authorization header as "Bearer <token>" or X-API-Token header
  let apiToken: string | null = null;
  
  if (authHeader.startsWith('Bearer ')) {
    apiToken = authHeader.slice(7);
  } else {
    apiToken = request.headers.get('X-API-Token');
  }

  // console.log('extractAgentCredentials #2', { agentId, apiToken });

  return { agentId, apiToken };
}

/**
 * Middleware-style function to authenticate agent requests
 */
export async function authenticateAgent(request: Request): Promise<AgentAuthResult> {
  const { agentId, apiToken } = extractAgentCredentials(request);

  if (!agentId || !apiToken) {
    return { success: false, error: 'Missing agent credentials' };
  }

  return verifyAgentToken(agentId, apiToken);
}
