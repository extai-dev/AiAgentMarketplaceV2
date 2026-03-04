'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Bid, BidStatusType, Task } from '@/store/useStore';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useSwitchChain } from 'wagmi';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { SIMPLE_ESCROW_ABI } from '@/lib/contracts/SimpleEscrow';
import { ERC20_ABI, SIMPLE_ESCROW_ADDRESS, TASK_TOKEN_ADDRESS } from '@/lib/contracts/addresses';
import { parseEther, type Address } from 'viem';
import { polygonAmoy } from 'wagmi/chains';
import {
  Coins,
  Check,
  X,
  Loader2,
  MessageSquare,
  ExternalLink,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';

interface BidListProps {
  task: Task;
  bids: Bid[];
  onBidAccepted?: () => void;
  onBidSubmitted?: () => void;
}

const statusConfig: Record<BidStatusType, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  PENDING: { label: 'Pending', variant: 'secondary' },
  ACCEPTED: { label: 'Accepted', variant: 'default' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  WITHDRAWN: { label: 'Withdrawn', variant: 'outline' },
};

export function BidList({ task, bids, onBidAccepted, onBidSubmitted }: BidListProps) {
  const { address, chain } = useAccount();
  const { toast } = useToast();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const [processingBidId, setProcessingBidId] = useState<string | null>(null);
  const [approvalTxHash, setApprovalTxHash] = useState<Address | null>(null);
  const [depositTxHash, setDepositTxHash] = useState<Address | null>(null);
  const [pendingBid, setPendingBid] = useState<Bid | null>(null);
  const [isSyncingDb, setIsSyncingDb] = useState(false);

  const isCreator = address?.toLowerCase() === task.creator?.walletAddress?.toLowerCase();
  const isCorrectNetwork = chain?.id === 80002;

  // Token and escrow addresses
  const tokenAddress = TASK_TOKEN_ADDRESS as Address;
  const escrowAddress = SIMPLE_ESCROW_ADDRESS as Address;
  const hasEscrowContract = escrowAddress && escrowAddress !== '0x0000000000000000000000000000000000000000';

  // Read on-chain escrow status
  const { data: onChainEscrow, refetch: refetchOnChainEscrow } = useReadContract({
    address: escrowAddress,
    abi: SIMPLE_ESCROW_ABI,
    functionName: 'getEscrow',
    args: task?.numericId ? [BigInt(task.numericId)] : undefined,
    query: {
      enabled: !!escrowAddress && !!task?.numericId && hasEscrowContract,
    },
  });

  // Parse escrow data
  const escrowData = onChainEscrow as [bigint, Address, Address, boolean, boolean] | undefined;
  const onChainEscrowExists = escrowData ? escrowData[3] : false;
  const onChainEscrowAmount = escrowData ? Number(escrowData[0]) / 1e18 : 0;
  const onChainEscrowReleased = escrowData ? escrowData[4] : false;

  // Check if DB is out of sync with on-chain
  const dbNeedsSync = onChainEscrowExists && !task.escrowDeposited && task.status === 'OPEN';

  // Read token allowance for escrow
  const { data: tokenAllowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && escrowAddress ? [address, escrowAddress] : undefined,
    query: {
      enabled: !!tokenAddress && !!escrowAddress && !!address && isCreator && hasEscrowContract,
    },
  });

  // Read token balance
  const { data: tokenBalance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!tokenAddress && !!address && isCreator,
    },
  });

  // Wait for approval confirmation
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed } = useWaitForTransactionReceipt({
    hash: approvalTxHash || undefined,
  });

  // Wait for deposit confirmation
  const { isLoading: isDepositConfirming, isSuccess: isDepositConfirmed } = useWaitForTransactionReceipt({
    hash: depositTxHash || undefined,
  });

  // Handle approval confirmation - proceed to deposit
  useEffect(() => {
    const handleApprovalConfirmed = async () => {
      if (isApprovalConfirmed && approvalTxHash && pendingBid && hasEscrowContract) {
        setApprovalTxHash(null);
        await refetchAllowance();
        await executeDeposit(pendingBid);
      }
    };
    handleApprovalConfirmed();
  }, [isApprovalConfirmed, approvalTxHash, pendingBid, hasEscrowContract]);

  // Handle deposit confirmation - update database
  useEffect(() => {
    const handleDepositConfirmed = async () => {
      if (isDepositConfirmed && depositTxHash && pendingBid) {
        await updateDatabaseAfterDeposit(pendingBid, depositTxHash);
      }
    };
    handleDepositConfirmed();
  }, [isDepositConfirmed, depositTxHash, pendingBid]);

  // Function to update database after on-chain deposit
  const updateDatabaseAfterDeposit = async (bid: Bid, txHash: Address) => {
    try {
      const response = await fetch(`/api/tasks/${task.id}/bids`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidId: bid.id,
          status: 'ACCEPTED',
          escrowDeposited: true,
          txHash: txHash,
          forceAccept: true, // Allow re-accepting if already accepted
        }),
      });

      const result = await response.json();
      if (result.success) {
        toast({
          title: 'Bid Accepted & Escrow Deposited!',
          description: 'Funds are locked on-chain. Agent can now start working.',
        });
        (onBidAccepted || onBidSubmitted)?.();
      } else {
        throw new Error(result.error || 'Failed to update database');
      }
    } catch (error: any) {
      console.error('Error updating database:', error);
      toast({
        title: 'Database Update Failed',
        description: 'Escrow deposited but failed to update database. Click "Sync DB" to retry.',
        variant: 'destructive',
      });
    } finally {
      setDepositTxHash(null);
      setPendingBid(null);
      setProcessingBidId(null);
    }
  };

  // Handle sync DB - update database when on-chain escrow exists but DB is out of sync
  const handleSyncDb = async () => {
    if (!task.numericId || !onChainEscrowExists) return;

    setIsSyncingDb(true);
    try {
      // Find the pending bid to accept
      const pendingBid = bids.find(b => b.status === 'PENDING');
      if (!pendingBid) {
        toast({
          title: 'No Pending Bid',
          description: 'No pending bid found to accept.',
          variant: 'destructive',
        });
        return;
      }

      // Get transaction hash from the most recent escrow deposit
      // We'll use a placeholder since we don't have the actual tx hash
      const response = await fetch(`/api/tasks/${task.id}/bids`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidId: pendingBid.id,
          status: 'ACCEPTED',
          escrowDeposited: true,
          txHash: `on-chain-escrow-${task.numericId}`,
          forceAccept: true,
        }),
      });

      const result = await response.json();
      if (result.success) {
        toast({
          title: 'Database Synced!',
          description: `Escrow (${onChainEscrowAmount} TT) confirmed on-chain. Database updated.`,
        });
        (onBidAccepted || onBidSubmitted)?.();
      } else {
        throw new Error(result.error || 'Failed to sync database');
      }
    } catch (error: any) {
      console.error('Error syncing database:', error);
      toast({
        title: 'Sync Failed',
        description: error.message || 'Failed to sync database. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncingDb(false);
    }
  };

  const handleSwitchNetwork = async () => {
    try {
      await switchChainAsync({ chainId: polygonAmoy.id });
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  };

  // Execute deposit on-chain
  const executeDeposit = async (bid: Bid) => {
    if (!hasEscrowContract || !task.numericId) {
      toast({
        title: 'Cannot Deposit',
        description: 'SimpleEscrow contract not deployed or task missing numeric ID.',
        variant: 'destructive',
      });
      setProcessingBidId(null);
      setPendingBid(null);
      return;
    }

    const amountWei = parseEther(bid.amount.toString());

    try {
      toast({
        title: 'Depositing escrow...',
        description: 'Please confirm the transaction in your wallet.',
      });

      const hash = await writeContractAsync({
        address: escrowAddress,
        abi: SIMPLE_ESCROW_ABI,
        functionName: 'depositEscrow',
        args: [BigInt(task.numericId), amountWei],
      });

      setDepositTxHash(hash as Address);
      toast({
        title: 'Transaction submitted',
        description: 'Waiting for confirmation...',
      });
    } catch (error: any) {
      console.error('Error depositing escrow:', error);
      toast({
        title: 'Transaction Failed',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
      setProcessingBidId(null);
      setPendingBid(null);
    }
  };

  // Accept bid with escrow deposit
  const handleAcceptBid = async (bid: Bid) => {
    if (!isCreator || !isCorrectNetwork) return;

    // Check if escrow contract is deployed
    if (!hasEscrowContract) {
      toast({
        title: 'SimpleEscrow Not Deployed',
        description: 'Please deploy the SimpleEscrow contract first. Visit /admin/deploy',
        variant: 'destructive',
      });
      return;
    }

    // Check if task has numeric ID
    if (!task.numericId) {
      toast({
        title: 'Task Missing Numeric ID',
        description: 'This task does not have a numeric ID for on-chain operations.',
        variant: 'destructive',
      });
      return;
    }

    setProcessingBidId(bid.id);
    setPendingBid(bid);

    const amount = bid.amount.toString();
    const amountWei = parseEther(amount);

    // Check token balance
    const balance = tokenBalance as bigint;
    if (balance && balance < amountWei) {
      toast({
        title: 'Insufficient Token Balance',
        description: `You need ${amount} TT but have ${(Number(balance) / 1e18).toFixed(2)} TT.`,
        variant: 'destructive',
      });
      setProcessingBidId(null);
      setPendingBid(null);
      return;
    }

    try {
      // Check if we need to approve tokens
      const allowance = tokenAllowance as bigint;
      if (!allowance || allowance < amountWei) {
        toast({
          title: 'Step 1/2: Approving Tokens',
          description: 'Please confirm the approval transaction.',
        });

        const approveHash = await writeContractAsync({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [escrowAddress, amountWei],
        });

        setApprovalTxHash(approveHash as Address);
        toast({
          title: 'Approval submitted',
          description: 'Waiting for confirmation before deposit...',
        });
        return;
      }

      // Already approved, proceed to deposit
      await executeDeposit(bid);
    } catch (error: any) {
      console.error('Error in accept bid flow:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to accept bid',
        variant: 'destructive',
      });
      setProcessingBidId(null);
      setPendingBid(null);
    }
  };

  const handleRejectBid = async (bid: Bid) => {
    if (!isCreator) return;

    setProcessingBidId(bid.id);

    try {
      const response = await fetch(`/api/tasks/${task.id}/bids`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidId: bid.id,
          status: 'REJECTED',
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Bid rejected',
          description: 'The bid has been rejected.',
        });
        (onBidAccepted || onBidSubmitted)?.();
      } else {
        throw new Error(result.error || 'Failed to reject bid');
      }
    } catch (error: any) {
      console.error('Error rejecting bid:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to reject bid',
        variant: 'destructive',
      });
    } finally {
      setProcessingBidId(null);
    }
  };

  const isLoading = isApprovalConfirming || isDepositConfirming || isSwitchingChain || isSyncingDb;
  const acceptedBid = bids.find(b => b.status === 'ACCEPTED');

  if (bids.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Bids
          </CardTitle>
          <CardDescription>No bids yet</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No bids have been placed yet.</p>
            <p className="text-sm mt-1">Be the first to bid on this task!</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Bids ({bids.length})
        </CardTitle>
        <CardDescription>
          {isCreator
            ? hasEscrowContract
              ? 'Accept a bid to deposit escrow and assign the task'
              : '⚠️ SimpleEscrow not deployed - accept bid without escrow'
            : 'Bids submitted by agents'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Network Warning */}
        {isCreator && !isCorrectNetwork && (
          <div className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-900 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-orange-800 dark:text-orange-200">
                Switch to Polygon Amoy for on-chain operations
              </span>
              <Button
                size="sm"
                onClick={handleSwitchNetwork}
                disabled={isSwitchingChain}
              >
                {isSwitchingChain ? 'Switching...' : 'Switch'}
              </Button>
            </div>
          </div>
        )}

        {/* No Escrow Contract Warning */}
        {isCreator && !hasEscrowContract && task.status === 'OPEN' && (
          <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-900 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-yellow-800 dark:text-yellow-200">
                ⚠️ SimpleEscrow contract not deployed. Bids can be accepted but escrow will not be deposited on-chain.
                <a href="/admin/deploy" className="underline ml-1">Deploy contract</a>
              </span>
            </div>
          </div>
        )}

        {/* DB Out of Sync Warning - Show Sync Button */}
        {isCreator && dbNeedsSync && (
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="text-sm text-amber-800 dark:text-amber-200">
                  ⚠️ Escrow found on-chain ({onChainEscrowAmount} TT) but database not updated.
                </span>
              </div>
              <Button
                size="sm"
                variant="default"
                className="gap-1"
                onClick={handleSyncDb}
                disabled={isSyncingDb}
              >
                {isSyncingDb ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Sync DB
              </Button>
            </div>
          </div>
        )}

        {/* Transaction Status */}
        {(isApprovalConfirming || isDepositConfirming) && (
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <span className="text-sm text-blue-800 dark:text-blue-200">
                {isApprovalConfirming ? 'Step 1/2: Confirming token approval...' : 'Step 2/2: Confirming escrow deposit...'}
              </span>
            </div>
            {(depositTxHash || approvalTxHash) && (
              <a
                href={`https://amoy.polygonscan.com/tx/${depositTxHash || approvalTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-2"
              >
                View on PolygonScan <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {/* Escrow Status for Accepted Bids */}
        {isCreator && acceptedBid && task.escrowDeposited && (
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-800 dark:text-green-200">
                ✓ Escrow deposited: {acceptedBid.amount} {task.tokenSymbol}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {bids.map((bid) => {
            const status = statusConfig[bid.status];
            const isProcessing = processingBidId === bid.id;

            return (
              <div
                key={bid.id}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>
                        {bid.agent?.name?.[0]?.toUpperCase() || bid.agentId.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">
                        {bid.agent?.name || `${bid.agent?.walletAddress?.slice(0, 8)}...`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(bid.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Coins className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{bid.amount} {task.tokenSymbol}</span>
                  </div>
                </div>

                {bid.message && (
                  <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded">
                    {bid.message}
                  </p>
                )}

                {/* Actions for creator */}
                {isCreator && bid.status === 'PENDING' && task.status === 'OPEN' && !dbNeedsSync && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="gap-1"
                      onClick={() => handleAcceptBid(bid)}
                      disabled={isProcessing || isLoading || !isCorrectNetwork}
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Accept & Deposit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => handleRejectBid(bid)}
                      disabled={isProcessing || isLoading}
                    >
                      <X className="h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
