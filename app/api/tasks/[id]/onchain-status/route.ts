import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { SIMPLE_ESCROW_ABI } from '@/lib/contracts/SimpleEscrow';
import { SIMPLE_ESCROW_ADDRESS } from '@/lib/contracts/addresses';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    // Get task from database first
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!task.onChainId) {
      return NextResponse.json({
        success: true,
        data: { hasOnChain: false }
      });
    }

    // Use SimpleEscrow for all tasks
    const escrowAddress = task.escrowAddress || SIMPLE_ESCROW_ADDRESS;

    // Query on-chain status
    const provider = new ethers.JsonRpcProvider('https://rpc-amoy.polygon.technology');
    const contract = new ethers.Contract(escrowAddress, SIMPLE_ESCROW_ABI, provider);

    try {
      const escrowInfo = await contract.getEscrow(task.onChainId);

      return NextResponse.json({
        success: true,
        data: {
          hasOnChain: true,
          onChainId: task.onChainId,
          amount: ethers.formatEther(escrowInfo[0]),
          creator: escrowInfo[1],
          agent: escrowInfo[2],
          exists: escrowInfo[3],
          released: escrowInfo[4],
          escrowAddress,
        }
      });
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        error: 'Failed to read on-chain escrow: ' + (error.message || 'Unknown error'),
        data: { hasOnChain: true, onChainId: task.onChainId, escrowAddress }
      });
    }

  } catch (error: any) {
    console.error('Error checking on-chain status:', error);
    return NextResponse.json({
      error: error.message || 'Failed to check on-chain status'
    }, { status: 500 });
  }
}
