import { NextRequest, NextResponse } from 'next/server';
import { BidStatus } from '@prisma/client';
import { db } from '@/lib/db';
import axios from 'axios';
import { signPayload } from '@/lib/agent-crypto';

/**
 * GET /api/tasks/[id]/bids
 * Fetch all bids for a task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify task exists
    const task = await db.task.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    const bids = await db.bid.findMany({
      where: { taskId: id },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      success: true,
      data: bids,
    });
  } catch (error) {
    console.error('Error fetching bids:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch bids' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks/[id]/bids
 * Submit a new bid for a task
 * 
 * Accepts either:
 * - agentId (existing user ID)
 * - agentWalletAddress (will find or create user)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { agentId, agentWalletAddress, amount, message, txHash } = body;

    // Validation
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Amount must be a positive number' },
        { status: 400 }
      );
    }

    // Verify task exists and is open
    const task = await db.task.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    if (task.status !== 'OPEN') {
      return NextResponse.json(
        { success: false, error: 'Task is not open for bidding' },
        { status: 400 }
      );
    }

    // Get or create agent user
    let agent;
    
    if (agentId) {
      agent = await db.agent.findUnique({
        where: { id: agentId },
      });
    }

    console.log('Agent in bids:', agent);
    
    // if (!agent && agentWalletAddress) {
    //   agent = await db.agent.upsert({
    //     where: { walletAddress: agentWalletAddress },
    //     update: {},
    //     create: {
    //       walletAddress: agentWalletAddress,
    //       name: 'Agent',
    //       //role: 'agent',
    //     },
    //   });
    // }
    
    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found and no wallet address provided' },
        { status: 400 }
      );
    }

    // Check if agent is the creator
    if (agent.id === task.creatorId) {
      return NextResponse.json(
        { success: false, error: 'Cannot bid on your own task' },
        { status: 400 }
      );
    }

    // Check if agent already has a pending bid
    const existingBid = await db.bid.findFirst({
      where: {
        taskId: id,
        agentId: agent.id,
        status: BidStatus.PENDING,
      },
    });

    if (existingBid) {
      return NextResponse.json(
        { success: false, error: 'Agent already has a pending bid on this task' },
        { status: 400 }
      );
    }

    // Create bid
    const bid = await db.bid.create({
      data: {
        taskId: id,
        agentId: agent.id,
        amount,
        message,
        txHash,
        status: BidStatus.PENDING,
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: bid,
      message: 'Bid submitted successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating bid:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create bid' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/tasks/[id]/bids
 * Update bid status (accept, reject)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { bidId, status, forceAccept } = body;

    if (!bidId || !status) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: bidId, status' },
        { status: 400 }
      );
    }

    // Verify bid exists and belongs to this task
    const bid = await db.bid.findFirst({
      where: { id: bidId, taskId: id },
    });

    if (!bid) {
      return NextResponse.json(
        { success: false, error: 'Bid not found' },
        { status: 404 }
      );
    }

    // Allow force accept for already-accepted bids (idempotent operation)
    // This handles cases where on-chain ops succeeded but DB update failed
    if (status === 'ACCEPTED' && bid.status === BidStatus.ACCEPTED && forceAccept) {
      // Bid already accepted, but update task if escrow info provided
      if (body.escrowDeposited || body.txHash) {
        const updateData: any = {};
        if (body.escrowDeposited) {
          updateData.escrowDeposited = true;
        }
        if (body.txHash) {
          updateData.txHash = body.txHash;
        }
        // Also ensure task is IN_PROGRESS and has agent assigned
        updateData.agentId = bid.agentId;
        updateData.status = 'IN_PROGRESS';

        await db.task.update({
          where: { id },
          data: updateData,
        });
      }
      return NextResponse.json({
        success: true,
        data: bid,
        message: 'Bid already accepted, task updated',
      });
    }

    // Also allow forceAccept for PENDING bids even if already accepted once
    // This handles the case where the user retries after DB failure
    if (status === 'ACCEPTED' && forceAccept) {
      // Proceed with the update regardless of current status
    } else if (bid.status !== BidStatus.PENDING) {
      return NextResponse.json(
        { success: false, error: 'Can only update pending bids' },
        { status: 400 }
      );
    }

    // Update bid status
    const updatedBid = await db.bid.update({
      where: { id: bidId },
      data: { status: status as BidStatus },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
    });

    // If bid is accepted, update task status and assign agent
    if (status === BidStatus.ACCEPTED) {
      const updateData: any = {
        agentId: bid.agentId,
        status: 'IN_PROGRESS',
      };
      
      // Mark escrow as deposited if provided
      if (body.escrowDeposited) {
        updateData.escrowDeposited = true;
      }
      
      // Store txHash if provided
      if (body.txHash) {
        updateData.txHash = body.txHash;
      }
      
      await db.task.update({
        where: { id },
        data: updateData,
      });

      // Reject all other pending bids
      await db.bid.updateMany({
        where: {
          taskId: id,
          id: { not: bidId },
          status: BidStatus.PENDING,
        },
        data: { status: BidStatus.REJECTED },
      });

      // Notify the agent that their bid was accepted
      try {
        // Get the agent details
        const agent = await db.agent.findUnique({
          where: { id: bid.submittedById || bid.agentId },
        });

        if (agent && agent.execUrl) {
          // Get the task details for the notification
          const task = await db.task.findUnique({
            where: { id },
            include: {
              creator: {
                select: { walletAddress: true, name: true },
              },
            },
          });

          if (task) {
            const notificationPayload = {
              type: 'BID_ACCEPTED',
              timestamp: new Date().toISOString(),
              notificationId: `bid-accepted-${bid.id}-${Date.now()}`,
              agent: {
                id: agent.id,
                name: agent.name,
              },
              task: {
                id: task.id,
                numericId: task.numericId,
                title: task.title,
                description: task.description,
                reward: task.reward,
                tokenSymbol: task.tokenSymbol,
                status: task.status,
                deadline: task.deadline ? task.deadline.toISOString() : null,
                escrowDeposited: task.escrowDeposited,
                creator: {
                  walletAddress: task.creator.walletAddress,
                  name: task.creator.name,
                },
              },
              bid: {
                id: bid.id,
                amount: bid.amount,
                message: bid.message,
              },
            };

            // Sign the payload
            const signature = signPayload(notificationPayload, agent.apiTokenHash || 'default-signing-key');

            // Send notification to agent
            await axios.post(agent.execUrl, notificationPayload, {
              headers: {
                'Content-Type': 'application/json',
                'X-Agent-ID': agent.id,
                'X-Signature': signature,
                'X-Notification-ID': notificationPayload.notificationId,
              },
              timeout: 10000,
            }).catch(err => {
              // Log but don't fail the request if notification fails
              console.error('Failed to notify agent of bid acceptance:', err.message);
            });

            console.log(`[Bids] Notified agent ${agent.id} of bid acceptance for task ${task.id}`);
          }
        }
      } catch (notifyError) {
        // Log but don't fail the main operation
        console.error('Error notifying agent:', notifyError);
      }
    }

    return NextResponse.json({
      success: true,
      data: updatedBid,
      message: `Bid ${status.toLowerCase()} successfully`,
    });
  } catch (error) {
    console.error('Error updating bid:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update bid' },
      { status: 500 }
    );
  }
}
