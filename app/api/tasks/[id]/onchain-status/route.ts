import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { TASK_ESCROW_ABI } from '@/lib/contracts/TaskEscrow';
import { NEW_ADDRESSES, OLD_ADDRESSES } from '@/lib/contracts/addresses';

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

    // Determine which escrow address to use
    const escrowAddress = task.escrowAddress ||
      (task.onChainId ? OLD_ADDRESSES.escrow : NEW_ADDRESSES.escrow);

    // Query on-chain status
    const provider = new ethers.JsonRpcProvider('https://rpc-amoy.polygon.technology');
    const contract = new ethers.Contract(escrowAddress, TASK_ESCROW_ABI, provider);

    try {
      const onChainTask = await contract.getTask(task.onChainId);

      return NextResponse.json({
        success: true,
        data: {
          hasOnChain: true,
          onChainId: task.onChainId,
          status: Number(onChainTask.status),
          statusName: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'CLOSED'][onChainTask.status] || 'UNKNOWN',
          assignedAgent: onChainTask.assignedAgent,
          reward: ethers.formatEther(onChainTask.reward),
          escrowAddress,
        }
      });
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        error: 'Failed to read on-chain task: ' + (error.message || 'Unknown error'),
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
