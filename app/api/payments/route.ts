/**
 * Payments API Route
 * 
 * Handles x402 payment operations using ChaosChain facilitator:
 * - POST: Create payment request, verify, settle, submit feedback
 * 
 * x402 Protocol Flow:
 * 1. Create payment requirements (amount, merchant, resource)
 * 2. Verify payment (prepare transaction)
 * 3. User signs EIP-3009 transferWithAuthorization
 * 4. Settle payment (gasless USDC transfer)
 * 5. Submit feedback with payment proof (on-chain reputation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { chaosChainService, PaymentRequirements } from '@/lib/chaoschain-service';

/**
 * POST /api/payments
 * 
 * Actions:
 * - create: Create payment requirements for agent task
 * - verify: Verify payment requirements before settlement
 * - settle: Execute gasless payment via EIP-3009
 * - feedback: Submit reputation feedback with payment proof
 * - status: Get payment status by transaction hash
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;

    switch (action) {
      case 'create': {
        // Create payment request for agent task
        if (!params.agentAddress) {
          return NextResponse.json(
            { success: false, error: 'Agent address is required' },
            { status: 400 }
          );
        }

        if (!params.amount || BigInt(params.amount) <= BigInt(0)) {
          return NextResponse.json(
            { success: false, error: 'Valid payment amount is required' },
            { status: 400 }
          );
        }

        if (!params.resource) {
          return NextResponse.json(
            { success: false, error: 'Resource description is required' },
            { status: 400 }
          );
        }

        const result = await chaosChainService.createPaymentRequest({
          agentAddress: params.agentAddress,
          amount: params.amount,
          resource: params.resource,
          description: params.description || `Task for agent ${params.agentAddress}`,
        });

        if (!result.success || !result.paymentRequirements) {
          return NextResponse.json(
            { success: false, error: result.error || 'Failed to create payment request' },
            { status: 500 }
          );
        }

        // Return payment requirements with serialized bigint
        return NextResponse.json({
          success: true,
          data: {
            ...result.paymentRequirements,
            amount: result.paymentRequirements.amount.toString(),
          },
        });
      }

      case 'verify': {
        // Verify payment requirements
        if (!params.paymentRequirements) {
          return NextResponse.json(
            { success: false, error: 'Payment requirements are required' },
            { status: 400 }
          );
        }

        // Deserialize bigint
        const paymentRequirements: PaymentRequirements = {
          ...params.paymentRequirements,
          amount: BigInt(params.paymentRequirements.amount),
        };

        const result = await chaosChainService.verifyPayment(paymentRequirements);

        return NextResponse.json({
          success: result.success,
          valid: result.valid,
        });
      }

      case 'settle': {
        // Execute gasless payment via EIP-3009
        if (!params.from) {
          return NextResponse.json(
            { success: false, error: 'Payer address is required' },
            { status: 400 }
          );
        }

        if (!params.paymentRequirements) {
          return NextResponse.json(
            { success: false, error: 'Payment requirements are required' },
            { status: 400 }
          );
        }

        if (!params.authorization) {
          return NextResponse.json(
            { success: false, error: 'EIP-3009 authorization is required' },
            { status: 400 }
          );
        }

        // Deserialize bigint
        const paymentRequirements: PaymentRequirements = {
          ...params.paymentRequirements,
          amount: BigInt(params.paymentRequirements.amount),
        };

        const result = await chaosChainService.settlePayment({
          from: params.from,
          paymentRequirements,
          authorization: params.authorization,
        });

        // If payment successful and feedback requested, submit feedback
        if (result.success && params.submitFeedback && result.transactionHash) {
          try {
            const feedbackResult = await chaosChainService.submitFeedback({
              agentId: params.agentId,
              rating: params.rating,
              comment: params.comment,
              proofOfPayment: {
                transactionHash: result.transactionHash,
                amount: paymentRequirements.amount,
              },
            });

            return NextResponse.json({
              success: result.success,
              transactionHash: result.transactionHash,
              status: result.status,
              feedbackSubmitted: feedbackResult.success,
              feedbackTxHash: feedbackResult.transactionHash,
            });
          } catch (feedbackError) {
            // Payment succeeded but feedback failed - don't fail the request
            console.error('Feedback submission error:', feedbackError);
            return NextResponse.json({
              success: result.success,
              transactionHash: result.transactionHash,
              status: result.status,
              feedbackSubmitted: false,
              feedbackError: 'Payment successful but feedback submission failed',
            });
          }
        }

        return NextResponse.json({
          success: result.success,
          transactionHash: result.transactionHash,
          status: result.status,
          error: result.error,
        });
      }

      case 'feedback': {
        // Submit reputation feedback with payment proof
        if (!params.agentId) {
          return NextResponse.json(
            { success: false, error: 'Agent ID is required' },
            { status: 400 }
          );
        }

        if (!params.rating || params.rating < 1 || params.rating > 5) {
          return NextResponse.json(
            { success: false, error: 'Rating must be between 1 and 5' },
            { status: 400 }
          );
        }

        if (!params.proofOfPayment?.transactionHash) {
          return NextResponse.json(
            { success: false, error: 'Payment proof (transaction hash) is required' },
            { status: 400 }
          );
        }

        const result = await chaosChainService.submitFeedback({
          agentId: params.agentId,
          chainId: params.chainId,
          rating: params.rating,
          comment: params.comment,
          proofOfPayment: {
            transactionHash: params.proofOfPayment.transactionHash,
            amount: BigInt(params.proofOfPayment.amount || 0),
          },
        });

        if (!result.success) {
          return NextResponse.json(
            { success: false, error: result.error || 'Failed to submit feedback' },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          transactionHash: result.transactionHash,
        });
      }

      case 'status': {
        // Get payment status by transaction hash
        if (!params.transactionHash) {
          return NextResponse.json(
            { success: false, error: 'Transaction hash is required' },
            { status: 400 }
          );
        }

        const result = await chaosChainService.getPaymentStatus(params.transactionHash);

        return NextResponse.json({
          success: result.success,
          transactionHash: result.transactionHash,
          status: result.status,
          error: result.error,
        });
      }

      case 'history': {
        // Get agent's payment history
        if (!params.agentAddress) {
          return NextResponse.json(
            { success: false, error: 'Agent address is required' },
            { status: 400 }
          );
        }

        const result = await chaosChainService.getPaymentHistory(params.agentAddress);

        if (!result.success) {
          return NextResponse.json(
            { success: false, error: 'Failed to fetch payment history' },
            { status: 500 }
          );
        }

        // Serialize bigint
        return NextResponse.json({
          success: true,
          payments: result.payments?.map(p => ({
            ...p,
            amount: p.amount.toString(),
          })),
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Invalid action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Payments API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/payments
 * 
 * Get payment chain configuration
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'config') {
    // Return chain configuration (safe to expose)
    const config = chaosChainService.getChainConfig();
    return NextResponse.json({
      success: true,
      config: {
        chainId: config.chainId,
        chainName: config.chainName,
        usdcAddress: config.usdcAddress,
        facilitatorFeePercent: config.facilitatorFeePercent,
      },
    });
  }

  return NextResponse.json(
    { success: false, error: 'Invalid action. Use ?action=config' },
    { status: 400 }
  );
}
