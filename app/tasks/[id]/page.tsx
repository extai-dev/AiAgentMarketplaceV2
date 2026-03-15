'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useReadContract } from 'wagmi';
import { polygonAmoy } from 'wagmi/chains';
import { parseEther, type Address } from 'viem';
import { ClientNavbar } from '@/components/marketplace/ClientNavbar';
import { BidList } from '@/components/marketplace/BidList';
import { BidForm } from '@/components/marketplace/BidForm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useStore, Task, Bid, TaskStatusType } from '@/store/useStore';
import { isValidAddress } from '@/lib/contracts/addresses';
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
  Shield,
  Send
} from 'lucide-react';

const statusConfig: Record<TaskStatusType, { label: string; color: string; icon: React.ReactNode }> = {
  OPEN: { label: 'Open for Bids', color: 'bg-blue-500', icon: <Clock className="h-4 w-4" /> },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-yellow-500', icon: <Loader2 className="h-4 w-4" /> },
  VALIDATING: { label: 'Validating', color: 'bg-purple-500', icon: <Shield className="h-4 w-4" /> },
  COMPLETED: { label: 'Completed', color: 'bg-green-500', icon: <CheckCircle2 className="h-4 w-4" /> },
  DISPUTED: { label: 'Disputed', color: 'bg-red-500', icon: <AlertCircle className="h-4 w-4" /> },
  CLOSED: { label: 'Closed', color: 'bg-gray-500', icon: <CheckCircle2 className="h-4 w-4" /> },
  CANCELLED: { label: 'Cancelled', color: 'bg-gray-400', icon: <XCircle className="h-4 w-4" /> },
  FAILED: { label: 'Failed', color: 'bg-red-600', icon: <XCircle className="h-4 w-4" /> },
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
  const [workSubmission, setWorkSubmission] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [txHash, setTxHash] = useState<Address | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);
  const [isSubmittingWork, setIsSubmittingWork] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  
  // Work submission form state
  const [workContent, setWorkContent] = useState('');
  const [resultUri, setResultUri] = useState('');
  
  // Validation form state
  const [validationScore, setValidationScore] = useState(100);
  const [validationComments, setValidationComments] = useState('');

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
          // Also fetch work submission
          if (taskData.data.workSubmission) {
            setWorkSubmission(taskData.data.workSubmission);
          }
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
        // Also refresh work submission
        if (data.data.workSubmission) {
          setWorkSubmission(data.data.workSubmission);
        } else {
          setWorkSubmission(null);
        }
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
        // First, update the escrow status to RELEASED in the database
        const escrowResponse = await fetch('/api/escrow/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: task.id,
            txHash,
          }),
        });

        const escrowResult = await escrowResponse.json();
        if (!escrowResult.success) {
          console.error('Failed to update escrow status:', escrowResult.error);
          // Continue anyway - the on-chain release happened
        }

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

  // Get escrow status from DATABASE only (source of truth)
  // For new tasks without deposit, DB escrow will be null
  const dbEscrow = (task as any)?.escrow;
  const dbEscrowStatus = dbEscrow?.status; // 'PENDING' | 'LOCKED' | 'RELEASED' | 'REFUNDED'
  const dbEscrowAmount = dbEscrow?.amount || 0;
  
  // DATABASE is the source of truth - only trust DB status
  // No on-chain fallback
  let escrowStatus: 'PENDING' | 'LOCKED' | 'RELEASED' | 'REFUNDED' = 'PENDING';
  if (dbEscrowStatus) {
    escrowStatus = dbEscrowStatus;
  }
  
  // Check escrow exists - use both escrow record amount AND task's escrowDeposited flag
  // The escrowDeposited flag on Task is set when deposit occurs, so it's a reliable fallback
  const hasEscrowFromRecord = dbEscrowAmount > 0;
  const hasEscrowFromFlag = (task as any)?.escrowDeposited === true;
  const hasEscrow = hasEscrowFromRecord || hasEscrowFromFlag;
  
  // Display amount - use escrow record amount, or fall back to task reward if escrowDeposited is true
  const displayEscrowAmount = hasEscrowFromRecord ? dbEscrowAmount : (hasEscrowFromFlag ? task?.reward : 0);
  const isEscrowReleased = escrowStatus === 'RELEASED';

  const handleSwitchNetwork = async () => {
    try {
      await switchChainAsync({ chainId: polygonAmoy.id });
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  };

  // Complete Task - DATABASE ONLY (but requires escrow)
  // This is now replaced by work submission flow
  // const handleCompleteTask = async () => { ... }

  // Submit Work - Agent submits work for validation
  const handleSubmitWork = async () => {
    if (!task || !isAgent || !workContent.trim()) return;
    
    if (!hasEscrow) {
      toast({
        title: 'Cannot Submit Work',
        description: 'Escrow has not been deposited yet. Wait for the creator to deposit escrow.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmittingWork(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentWalletAddress: address,
          content: workContent,
          resultUri: resultUri || undefined,
          resultHash: resultUri ? `hash://${Date.now()}` : undefined,
        }),
      });

      const result = await response.json();
      if (result.success) {
        toast({
          title: 'Work Submitted!',
          description: 'Your work has been submitted for validation.',
        });
        setWorkContent('');
        setResultUri('');
        refreshTask();
      } else {
        throw new Error(result.error || 'Failed to submit work');
      }
    } catch (error: any) {
      console.error('Error submitting work:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmittingWork(false);
    }
  };

  // Validate Work - Task creator validates submitted work
  const handleValidateWork = async (approved: boolean) => {
    if (!task || !isCreator || !workSubmission) return;

    setIsValidating(true);
    try {
      const response = await fetch('/api/validation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: workSubmission.id,
          score: approved ? validationScore : Math.max(0, validationScore - 100),
          comments: validationComments,
          validatedBy: user?.id,
        }),
      });

      const result = await response.json();
      if (result.success) {
        toast({
          title: approved ? 'Work Approved!' : 'Work Rejected',
          description: approved 
            ? 'The work has been approved. You can now release payment.'
            : 'The work has been rejected. The agent can resubmit.',
        });
        setValidationComments('');
        refreshTask();
      } else {
        throw new Error(result.error || 'Failed to validate work');
      }
    } catch (error: any) {
      console.error('Error validating work:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsValidating(false);
    }
  };

  // Fetch work submission for this task
  const fetchWorkSubmission = async () => {
    if (!task) return;
    try {
      const response = await fetch(`/api/tasks/${task.id}`);
      const data = await response.json();
      if (data.success && data.data.workSubmission) {
        setWorkSubmission(data.data.workSubmission);
      } else {
        setWorkSubmission(null);
      }
    } catch (error) {
      console.error('Error fetching work submission:', error);
      setWorkSubmission(null);
    }
  };

  // Load work submission when task changes
  useEffect(() => {
    if (task) {
      fetchWorkSubmission();
    }
  }, [task?.id]);

  // Release Payment - ON-CHAIN (approveAndRelease)
  const handleReleasePayment = async () => {
    if (!task || !isCreator || !isCorrectNetwork) return;

    // Check if escrow exists (from DB or on-chain fallback)
    if (!hasEscrow) {
      toast({
        title: 'No Escrow Deposit',
        description: 'Escrow has not been deposited on-chain. Cannot release payment.',
        variant: 'destructive',
      });
      return;
    }

    // Check if already released (from DB)
    if (isEscrowReleased) {
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
        <ClientNavbar />
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
        <ClientNavbar />
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
      <ClientNavbar />
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
                    {hasEscrow && (
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-sm text-muted-foreground">
                          Escrow: {displayEscrowAmount.toFixed(2)} {task.tokenSymbol}
                        </p>
                        {/* Escrow Status Badge */}
                        {escrowStatus === 'RELEASED' && (
                          <Badge className="bg-green-500 text-white text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Released
                          </Badge>
                        )}
                        {escrowStatus === 'LOCKED' && (
                          <Badge className="bg-yellow-500 text-white text-xs">
                            <Coins className="h-3 w-3 mr-1" />
                            Deposited
                          </Badge>
                        )}
                        {escrowStatus === 'REFUNDED' && (
                          <Badge className="bg-gray-500 text-white text-xs">
                            <XCircle className="h-3 w-3 mr-1" />
                            Refunded
                          </Badge>
                        )}
                        {escrowStatus === 'PENDING' && hasEscrow && (
                          <Badge className="bg-blue-500 text-white text-xs">
                            <Clock className="h-3 w-3 mr-1" />
                            Pending
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Escrow Status Warning */}
            {task.status === 'IN_PROGRESS' && !hasEscrow && isCreator && (
              <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-900 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <span className="text-yellow-800 dark:text-yellow-200">
                    ⚠️ Escrow not deposited yet. Please deposit the escrow to start the work.
                  </span>
                </div>
              </div>
            )}

            {/* Escrow Deposited - Ready for work */}
            {task.status === 'IN_PROGRESS' && hasEscrow && !isEscrowReleased && isCreator && (
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-green-800 dark:text-green-200">
                    ✅ Escrow deposited and locked. Agent can now submit work for validation.
                  </span>
                </div>
              </div>
            )}

            {/* Escrow Deposited - For Agent */}
            {task.status === 'IN_PROGRESS' && hasEscrow && !isEscrowReleased && isAgent && (
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-green-800 dark:text-green-200">
                    ✅ Escrow has been deposited. You can now submit your work for validation.
                  </span>
                </div>
              </div>
            )}

            {/* Escrow Released - Payment Complete */}
            {isEscrowReleased && (
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-green-800 dark:text-green-200">
                    ✅ Payment has been released to the agent.
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
              {/* Agent actions - Submit Work is now in the sidebar */}

              {/* Creator actions - Release Payment */}
              {isCreator && task.status === 'COMPLETED' && !isEscrowReleased && (
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
                  {hasEscrow ? 'Release Payment' : 'No Escrow Deposited'}
                </Button>
              )}

              {/* Show released status when already released */}
              {isCreator && isEscrowReleased && (
                <Button
                  disabled
                  className="gap-2 bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Payment Released
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

            {/* Work Submission Form - For Agent */}
            {task.status === 'IN_PROGRESS' && isAgent && hasEscrow && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Submit Work
                  </CardTitle>
                  <CardDescription>
                    Submit your completed work for validation
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Work Description</label>
                    <Textarea
                      value={workContent}
                      onChange={(e) => setWorkContent(e.target.value)}
                      placeholder="Describe the work you have completed..."
                      rows={4}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Result URI (Optional)</label>
                    <Input
                      value={resultUri}
                      onChange={(e) => setResultUri(e.target.value)}
                      placeholder="ipfs:// or http://..."
                      className="mt-1"
                    />
                  </div>
                  <Button
                    onClick={handleSubmitWork}
                    disabled={isSubmittingWork || !workContent.trim()}
                    className="w-full gap-2"
                  >
                    {isSubmittingWork ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Submit Work for Validation
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Work Validation Status */}
            {task.status === 'VALIDATING' && (
              <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-900 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-purple-600" />
                  <span className="text-purple-800 dark:text-purple-200">
                    📝 Work is under validation. The task creator is reviewing the submitted work.
                  </span>
                </div>
              </div>
            )}

            {/* Work Validation Form - For Creator */}
            {task.status === 'VALIDATING' && isCreator && workSubmission && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Validate Work
                  </CardTitle>
                  <CardDescription>
                    Review and validate the submitted work
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Submitted Work:</p>
                    <p className="text-sm text-muted-foreground">{workSubmission.content}</p>
                    {workSubmission.resultUri && (
                      <a 
                        href={workSubmission.resultUri} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm text-blue-500 hover:underline"
                      >
                        View Result
                      </a>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium">Score (0-100)</label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={validationScore}
                      onChange={(e) => setValidationScore(parseInt(e.target.value) || 0)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Score ≥70 passes validation
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Comments</label>
                    <Textarea
                      value={validationComments}
                      onChange={(e) => setValidationComments(e.target.value)}
                      placeholder="Provide feedback on the work..."
                      rows={3}
                      className="mt-1"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleValidateWork(true)}
                      disabled={isValidating}
                      className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                    >
                      {isValidating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Approve
                    </Button>
                    <Button
                      onClick={() => handleValidateWork(false)}
                      disabled={isValidating}
                      variant="destructive"
                      className="flex-1 gap-2"
                    >
                      {isValidating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Work Submission Status */}
            {workSubmission && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Submission Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant={workSubmission.status === 'APPROVED' ? 'default' : workSubmission.status === 'REJECTED' ? 'destructive' : 'secondary'}>
                      {workSubmission.status}
                    </Badge>
                  </div>
                  {workSubmission.score !== null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Score:</span>
                      <span className="font-medium">{workSubmission.score}/100</span>
                    </div>
                  )}
                  {workSubmission.comments && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Feedback:</span>
                      <p className="mt-1">{workSubmission.comments}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
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
                      ? isEscrowReleased
                        ? `✓ Released (${displayEscrowAmount.toFixed(2)} ${task.tokenSymbol})`
                        : `✓ Deposited (${displayEscrowAmount.toFixed(2)} ${task.tokenSymbol})`
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
