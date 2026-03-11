import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { chaosChainService, formatAgentId, CHAIN_CONFIG, ERC8004AgentMetadata } from '@/lib/chaoschain-service';

/**
 * POST /api/agents/register-on-chain
 * Register an existing agent on ERC-8004 via ChaosChain SDK
 * 
 * Request body:
 * {
 *   agentId: string;
 *   ownerWalletAddress: string;
 *   metadata?: {
 *     name: string;
 *     description?: string;
 *     capabilities?: string[];
 *     endpoints?: Array<{
 *       name: string;
 *       endpoint: string;
 *       protocol?: string;
 *     }>;
 *     version?: string;
 *   };
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, ownerWalletAddress, metadata } = body;

    // Validation
    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    if (!ownerWalletAddress || !/^0x[a-fA-F0-9]{40}$/.test(ownerWalletAddress)) {
      return NextResponse.json(
        { success: false, error: 'Valid owner wallet address is required' },
        { status: 400 }
      );
    }

    // Get agent from database
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      include: {
        owner: {
          select: { id: true, walletAddress: true, name: true },
        },
      },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (agent.owner.walletAddress.toLowerCase() !== ownerWalletAddress.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: 'You are not the owner of this agent' },
        { status: 403 }
      );
    }

    // Build metadata
    const agentCapabilities = JSON.parse(agent.capabilities || '[]') as string[];
    const agentEndpoints = JSON.parse(agent.endpoints || '[]') as Array<{ endpoint: string; protocol: string; name?: string }>;
    
    const finalMetadata: ERC8004AgentMetadata = metadata || {
      name: agent.name,
      description: agent.description || '',
      capabilities: agentCapabilities,
      endpoints: agentEndpoints.map(e => ({
        name: e.name || 'default',
        endpoint: e.endpoint,
        protocol: e.protocol || 'https',
      })),
      version: '1.0.0',
      author: agent.owner.name || 'Unknown',
    };

    // Prepare services for registration
    const services = (finalMetadata.endpoints || []).map(e => ({
      endpoint: e.endpoint,
      protocol: e.protocol || 'https',
    }));

    // Register on ChaosChain (ERC-8004)
    const result = await chaosChainService.registerAgent({
      ownerAddress: agent.walletAddress,
      metadata: finalMetadata,
      services: services.length > 0 ? services : [{
        endpoint: agent.execUrl || 'https://example.com',
        protocol: 'https',
      }],
    });

    if (!result.success || !result.tokenId) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to register on chain' },
        { status: 500 }
      );
    }

    // Format ERC-8004 agent ID
    const erc8004AgentId = formatAgentId(CHAIN_CONFIG.chainId, result.tokenId);

    // Update agent with ERC-8004 ID
    await db.agent.update({
      where: { id: agentId },
      data: {
        erc8004AgentId,
        metadataUri: JSON.stringify(finalMetadata),
      },
    });

    // Log registration
    await db.agentLog.create({
      data: {
        agentId,
        level: 'INFO',
        action: 'ERC8004_REGISTERED',
        message: `Agent registered on ERC-8004: ${erc8004AgentId}`,
        metadata: JSON.stringify({
          erc8004AgentId,
          tokenId: result.tokenId,
          transactionHash: result.transactionHash,
          metadata: finalMetadata,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: agent.id,
        name: agent.name,
        erc8004AgentId,
        tokenId: result.tokenId,
        transactionHash: result.transactionHash,
        metadataUri: JSON.stringify(finalMetadata),
        chainId: CHAIN_CONFIG.chainId,
        chainName: CHAIN_CONFIG.chainName,
      },
      message: 'Agent registered on ERC-8004 successfully',
    }, { status: 201 });

  } catch (error) {
    console.error('Error registering agent on chain:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to register agent on chain' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agents/register-on-chain
 * Check registration status for an agent
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        erc8004AgentId: true,
        metadataUri: true,
        walletAddress: true,
      },
    });

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: agent.id,
        name: agent.name,
        isRegistered: !!agent.erc8004AgentId,
        erc8004AgentId: agent.erc8004AgentId,
        metadataUri: agent.metadataUri,
        walletAddress: agent.walletAddress,
        chainId: agent.erc8004AgentId ? CHAIN_CONFIG.chainId : null,
      },
    });

  } catch (error) {
    console.error('Error checking registration status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check registration status' },
      { status: 500 }
    );
  }
}
