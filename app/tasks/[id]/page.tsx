'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useReadContract } from 'wagmi';
import { polygonAmoy } from 'wagmi/chains';
import { parseEther, type Address } from 'viem';
import { Navbar } from '@/components/marketplace/Navbar';
import { BidList } from '@/components/marketplace/BidList';
import { BidForm } from '@/components/marketplace/BidForm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useStore, Task, Bid, TaskStatusType } from '@/store/useStore';
import { isValidAddress } from '@/hooks/useTaskContract';
import { SIMPLE_ESCROW_ABI } from '@/lib/contracts/SimpleEscrow';
import { ERC20_ABI, SIMPLE_ESCROW_ADDRESS, TASK_TOKEN_ADDRESS } from '@/lib/contracts/addresses';
import { formatDistanceToNow, format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Clock,
  Coins,
  AlertCircle,
  CheckCircle2,
  Loader2,
  XCircle,
  ExternalLink,
  FileText,
  Copy,
  Check,
  Shield
} from 'lucide-react';

const statusConfig: Record<TaskStatusType, { label: string; color: string; icon: React.ReactNode }> = {
  OPEN: { label: 'Open for Bids', color: 'bg-blue-500', icon: <Clock className="h-4 w-4" /> },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-yellow-500', icon: <Loader2 className="h-4 w-4" /> },
  COMPLETED: { label: 'Completed', color: 'bg-green-500', icon: <CheckCircle2 className="h-4 w-4" /> },
  DISPUTED: { label: 'Disputed', color: 'bg-red-500', icon: <AlertCircle className="h-4 w-4" /> },
  CLOSED: { label: 'Closed', color: 'bg-gray-500', icon: <CheckCircle2 className="h-4 w-4" /> },
  CANCELLED: { label: 'Cancelled', color: 'bg-gray-400', icon: <XCircle className="h-4 w-4" /> },
};

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;
  const { address, isConnected, chain } = useAccount();
  const { user } = useStore();
  const { toast } = useToast();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  const [task, setTask] = useState<Task | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [txHash, setTxHash] = useState<Address | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);

  // Simple escrow addresses
  const escrowAddress = SIMPLE_ESCROW_ADDRESS as Address;
  const tokenAddress = TASK_TOKEN_ADDRESS as Address;

  const hasContracts = isValidAddress(escrowAddress);
  const isCorrectNetwork = chain?.id === 80002; // Polygon Amoy

  // Read escrow info on-chain (if task has numericId)
  const { data: onChainEscrow, refetch: refetchEscrow } = useReadContract({
    address: escrowAddress,
    abi: SIMPLE_ESCROW_ABI,
    functionName: 'getEscrow',
    args: task?.numericId ? [BigInt(task.numericId)] : undefined,
    query: {
      enabled: !!escrowAddress && !!task?.numericId && hasContracts,
    },
  });

  // Wait for transaction confirmation
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: txReceipt } = useWaitForTransactionReceipt({
    hash: txHash || undefined,
  });

  // Fetch task and bids
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const taskResponse = await fetch(`/api/tasks/${taskId}`);
        const taskData = await taskResponse.json();
        if (taskData.success) {
          setTask(taskData.data);
          setBids(taskData.data.bids || []);
        } else {
          toast({
            title: 'Error',
            description: 'Task not found',
            variant: 'destructive',
          });
          router.push('/');
        }
      } catch (error) {
        console.error('Failed to fetch task:', error);
        toast({
          title: 'Error',
          description: 'Failed to load task',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    if (taskId) {
      fetchData();
    }
  }, [taskId, router, toast]);

  const refreshTask = async () => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`);
      const data = await response.json();
      if (data.success) {
        setTask(data.data);
        setBids(data.data.bids || []);
      }
    } catch (error) {
      console.error('Failed to refresh task:', error);
    }
  };

  // Handle transaction confirmation for release
  useEffect(() => {
    const handleConfirmation = async () => {
      if (!isConfirmed || !txHash || !task || !isReleasing) return;

      try {
        // Update database after blockchain confirmation
        const response = await fetch(`/api/tasks/${task.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'CLOSED',
            txHash,
          }),
        });

        const result = await response.json();
        if (result.success) {
          toast({
            title: 'Payment Released!',
            description: 'Tokens transferred to agent. Transaction confirmed on blockchain.',
          });
          refreshTask();
        } else {
          throw new Error(result.error || 'Failed to update database');
        }
      } catch (error: any) {
        console.error('Error updating database:', error);
        toast({
          title: 'Database Update Failed',
          description: 'Blockchain transaction succeeded but database update failed.',
          variant: 'destructive',
        });
      } finally {
        setTxHash(null);
        setIsReleasing(false);
      }
    };

    handleConfirmation();
  }, [isConfirmed, txHash, isReleasing, task, toast]);

  const isCreator = address?.toLowerCase() === task?.creator?.walletAddress?.toLowerCase();
  const isAgent = address?.toLowerCase() === task?.agent?.walletAddress?.toLowerCase();

  // Check if escrow exists on-chain
  const escrowData = onChainEscrow as [bigint, Address, Address, boolean, boolean] | undefined;
  const escrowAmount = escrowData ? Number(escrowData[0]) / 1e18 : 0;
  const escrowExists = escrowData ? escrowData[3] : false;
  const escrowReleased = escrowData ? escrowData[4] : false;

  // Check if task has valid escrow
  const hasEscrow = task?.escrowDeposited || escrowExists;

  const handleSwitchNetwork = async () => {
    try {
      await switchChainAsync({ chainId: polygonAmoy.id });
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  };

  // Complete Task - DATABASE ONLY (but requires escrow)
  const handleCompleteTask = async () => {
    if (!task || !isAgent) return;

    // Check if escrow has been deposited
    if (!hasEscrow) {
      toast({
        title: 'Cannot Complete Task',
        description: 'Escrow has not been deposited yet. Wait for the creator to deposit escrow.',
        variant: 'destructive',
      });
      return;
    }

    const resultHash = `ipfs://QmResult${Date.now()}`;

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'COMPLETED',
          resultHash,
        }),
      });

      const result = await response.json();
      if (result.success) {
        toast({
          title: 'Task marked complete!',
          description: 'Waiting for creator to release payment.',
        });
        refreshTask();
      } else {
        throw new Error(result.error || 'Failed to update task');
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Release Payment - ON-CHAIN (approveAndRelease)
  const handleReleasePayment = async () => {
    if (!task || !isCreator || !isCorrectNetwork) return;

    // Check if escrow exists on-chain
    if (!hasEscrow && !escrowExists) {
      toast({
        title: 'No Escrow Deposit',
        description: 'Escrow has not been deposited on-chain. Cannot release payment.',
        variant: 'destructive',
      });
      return;
    }

    // Check if already released
    if (escrowReleased) {
      toast({
        title: 'Already Released',
        description: 'Payment has already been released.',
        variant: 'destructive',
      });
      return;
    }

    // Get agent address
    const agentAddress = task.agent?.walletAddress;
    if (!agentAddress) {
      toast({
        title: 'No Agent Assigned',
        description: 'Cannot release payment without an assigned agent.',
        variant: 'destructive',
      });
      return;
    }

    // Need numeric ID for on-chain operation
    if (!task.numericId) {
      toast({
        title: 'Task Missing Numeric ID',
        description: 'This task does not have a numeric ID for on-chain operations.',
        variant: 'destructive',
      });
      return;
    }

    // Need escrow contract
    if (!hasContracts) {
      toast({
        title: 'No Escrow Contract',
        description: 'SimpleEscrow contract not deployed.',
        variant: 'destructive',
      });
      return;
    }

    setIsReleasing(true);

    try {
      toast({
        title: 'Releasing payment on-chain...',
        description: 'Please confirm the transaction in your wallet.',
      });

      // Call approveAndRelease on-chain
      const hash = await writeContractAsync({
        address: escrowAddress,
        abi: SIMPLE_ESCROW_ABI,
        functionName: 'approveAndRelease',
        args: [BigInt(task.numericId), agentAddress as Address],
      });

      setTxHash(hash as Address);
      toast({
        title: 'Transaction submitted',
        description: 'Waiting for confirmation...',
      });

    } catch (error: any) {
      console.error('Error releasing payment:', error);
      toast({
        title: 'Transaction Failed',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
      setIsReleasing(false);
    }
  };

  // Cancel Task
  const handleCancelTask = async () => {
    if (!task || !isCreator) return;

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });

      const result = await response.json();
      if (result.success) {
        toast({
          title: 'Task cancelled',
          description: 'The task has been cancelled.',
        });
        refreshTask();
      } else {
        throw new Error(result.error || 'Failed to cancel task');
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container px-4 py-8">
          <div className="space-y-6">
            <Skeleton className="h-8 w-32" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
              <div className="space-y-4">
                <Skeleton className="h-64 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container px-4 py-8">
          <div className="text-center py-12">
            <AlertCircle className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Task Not Found</h2>
            <p className="text-muted-foreground">The task you're looking for doesn't exist.</p>
            <Button className="mt-4" onClick={() => router.push('/')}>
              Go Home
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const status = statusConfig[task.status];
  const isLoadingTx = isConfirming || isReleasing;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container px-4 py-8">
        {/* Back button */}
        <Button variant="ghost" className="mb-6" onClick={() => router.push('/')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Tasks
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Task Header */}
            <div>
              <div className="flex items-start justify-between gap-4 mb-4">
                <h1 className="text-2xl font-bold">{task.title}</h1>
                <Badge className={status.color}>
                  {status.icon}
                  <span className="ml-1">{status.label}</span>
                </Badge>
              </div>

              {/* Task Meta */}
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
                </div>
                {task.deadline && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    Deadline: {format(new Date(task.deadline), 'PPP')}
                  </div>
                )}
                {task.txHash && (
                  <div className="flex items-center gap-1">
                    <ExternalLink className="h-4 w-4" />
                    <a
                      href={`https://amoy.polygonscan.com/tx/${task.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      View Transaction
                    </a>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Network Warning */}
            {isConnected && !isCorrectNetwork && (isCreator || isAgent) && (
              <div className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-900 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <span className="text-orange-800 dark:text-orange-200">
                      Switch to Polygon Amoy for on-chain operations
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSwitchNetwork}
                    disabled={isSwitchingChain}
                  >
                    {isSwitchingChain ? 'Switching...' : 'Switch Network'}
                  </Button>
                </div>
              </div>
            )}

            {/* Transaction Status */}
            {isLoadingTx && txHash && (
              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <span className="text-blue-800 dark:text-blue-200 font-medium">
                    ⏳ Confirming on blockchain...
                  </span>
                </div>
                <a
                  href={`https://amoy.polygonscan.com/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1 mt-2"
                >
                  View on PolygonScan <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* Description */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap">{task.description}</p>
              </CardContent>
            </Card>

            {/* Reward Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Reward</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Coins className="h-8 w-8 text-yellow-500" />
                  <div>
                    <p className="text-2xl font-bold">{task.reward} {task.tokenSymbol}</p>
                    {task.numericId && escrowExists && (
                      <p className="text-sm text-muted-foreground">
                        On-chain Escrow: {escrowAmount.toFixed(2)} {task.tokenSymbol}
                        {escrowReleased && ' (Released)'}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Escrow Status Warning */}
            {task.status === 'IN_PROGRESS' && !hasEscrow && isAgent && (
              <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-900 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <span className="text-yellow-800 dark:text-yellow-200">
                    ⚠️ Escrow not deposited yet. Wait for the creator to deposit escrow before completing work.
                  </span>
                </div>
              </div>
            )}

            {/* Assigned Agent */}
            {task.agent && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Assigned Agent</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>
                        {task.agent.name?.[0]?.toUpperCase() || task.agent.walletAddress.slice(1, 3).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{task.agent.name || 'Anonymous Agent'}</p>
                      <p className="text-sm text-muted-foreground font-mono">
                        {task.agent.walletAddress.slice(0, 8)}...{task.agent.walletAddress.slice(-6)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Result */}
            {task.resultHash && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Task Result</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <code className="text-sm flex-1 truncate">{task.resultHash}</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(task.resultHash!)}
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Bids List */}
            <BidList task={task} bids={bids} onBidSubmitted={refreshTask} onBidAccepted={refreshTask} />

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              {/* Agent actions - Complete Task */}
              {isAgent && task.status === 'IN_PROGRESS' && (
                <Button
                  onClick={handleCompleteTask}
                  disabled={isLoadingTx || !hasEscrow}
                  className="gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark Complete
                  {!hasEscrow && ' (Waiting for Escrow)'}
                </Button>
              )}

              {/* Creator actions - Release Payment */}
              {isCreator && task.status === 'COMPLETED' && (
                <Button
                  onClick={handleReleasePayment}
                  disabled={isLoadingTx || !isCorrectNetwork || !hasEscrow}
                  className="gap-2"
                >
                  {isReleasing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Coins className="h-4 w-4" />
                  )}
                  Release Payment
                  {!hasEscrow && ' (No Escrow)'}
                </Button>
              )}

              {/* Creator actions - Cancel Task */}
              {isCreator && (task.status === 'OPEN' || task.status === 'IN_PROGRESS') && (
                <Button
                  variant="destructive"
                  onClick={handleCancelTask}
                  disabled={isLoadingTx}
                  className="gap-2"
                >
                  <XCircle className="h-4 w-4" />
                  Cancel Task
                </Button>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Creator Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Task Creator</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>
                      {task.creator?.name?.[0]?.toUpperCase() || task.creator?.walletAddress?.slice(1, 3).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{task.creator?.name || 'Anonymous'}</p>
                    <p className="text-sm text-muted-foreground font-mono">
                      {task.creator?.walletAddress?.slice(0, 8)}...{task.creator?.walletAddress?.slice(-6)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bid Form */}
            {task.status === 'OPEN' && !isCreator && (
              <BidForm task={task} onBidSubmitted={refreshTask} />
            )}

            {/* Contract Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Blockchain Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Network</span>
                  <span className="font-medium">
                    {isCorrectNetwork ? '✓ Polygon Amoy' : chain?.name || 'Not connected'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mode</span>
                  <span className="font-medium">
                    {task.numericId ? '✓ On-chain ready' : 'Database only'}
                  </span>
                </div>
                {task.numericId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Task ID</span>
                    <span className="font-medium">#{task.numericId}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Escrow</span>
                  <span className="font-medium">
                    {hasEscrow
                      ? escrowReleased
                        ? `✓ Released (${escrowAmount.toFixed(2)} ${task.tokenSymbol})`
                        : `✓ Deposited (${escrowAmount.toFixed(2)} ${task.tokenSymbol})`
                      : '❌ Not deposited'}
                  </span>
                </div>
                {hasContracts && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Escrow Contract</span>
                    <a
                      href={`https://amoy.polygonscan.com/address/${escrowAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-600 hover:underline flex items-center gap-1"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                <div className="pt-2 border-t text-xs text-muted-foreground">
                  <p>✓ Task & Bids: Database only</p>
                  <p>✓ Accept Bid: depositEscrow() on-chain</p>
                  <p>✓ Complete: Database only (requires escrow)</p>
                  <p>✓ Release: approveAndRelease() on-chain</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
