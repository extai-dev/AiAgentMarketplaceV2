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
  Send,
  Users,
  Trophy,
  Bot,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  BarChart2,
  GitMerge,
  SplitSquareVertical,
  Code2,
  Link,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const statusConfig: Record<TaskStatusType, { label: string; color: string; icon: React.ReactNode }> = {
  OPEN: { label: 'Open for Bids', color: 'bg-blue-500', icon: <Clock className="h-4 w-4" /> },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-yellow-500', icon: <Loader2 className="h-4 w-4" /> },
  IN_REVIEW: { label: 'In Review', color: 'bg-orange-500', icon: <FileText className="h-4 w-4" /> },
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
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [txHash, setTxHash] = useState<Address | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);
  const [isSubmittingWork, setIsSubmittingWork] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState('');
  const [showRevisionInput, setShowRevisionInput] = useState(false);

  // Work submission form state
  const [workContent, setWorkContent] = useState('');
  const [resultUri, setResultUri] = useState('');
  const [submissionType, setSubmissionType] = useState<'text' | 'code' | 'url'>('text');
  const [codeLanguage, setCodeLanguage] = useState('javascript');

  // Multi-agent state
  const [multiAgentExecution, setMultiAgentExecution] = useState<any>(null);
  const [isDepositingEscrow, setIsDepositingEscrow] = useState(false);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);


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
        const [taskResponse, submissionsResponse] = await Promise.all([
          fetch(`/api/tasks/${taskId}`),
          fetch(`/api/tasks/${taskId}/submissions`),
        ]);
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
        const submissionsData = await submissionsResponse.json();
        if (submissionsData.success) {
          setSubmissions(submissionsData.data || []);
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
      const [taskRes, submissionsRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}`),
        fetch(`/api/tasks/${taskId}/submissions`),
      ]);
      const data = await taskRes.json();
      if (data.success) {
        setTask(data.data);
        setBids(data.data.bids || []);
        if (data.data.workSubmission) {
          setWorkSubmission(data.data.workSubmission);
        } else {
          setWorkSubmission(null);
        }
      }
      const submissionsData = await submissionsRes.json();
      if (submissionsData.success) {
        setSubmissions(submissionsData.data || []);
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
    if (!task || !isAgent) return;
    if (submissionType === 'url' ? !resultUri.trim() : !workContent.trim()) return;

    if (!hasEscrow) {
      toast({
        title: 'Cannot Submit Work',
        description: 'Escrow has not been deposited yet. Wait for the creator to deposit escrow.',
        variant: 'destructive',
      });
      return;
    }

    // Format content and build metadata based on submission type
    let finalContent = workContent;
    const filesMetadata: Record<string, string> = { _type: submissionType };
    if (submissionType === 'code') {
      finalContent = `\`\`\`${codeLanguage}\n${workContent}\n\`\`\``;
      filesMetadata._language = codeLanguage;
    } else if (submissionType === 'url') {
      finalContent = workContent.trim()
        ? `${resultUri.trim()}\n\n${workContent.trim()}`
        : resultUri.trim();
    }

    setIsSubmittingWork(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentWalletAddress: address,
          content: finalContent,
          resultUri: submissionType === 'url' ? resultUri || undefined : resultUri || undefined,
          resultHash: resultUri ? `hash://${Date.now()}` : undefined,
          files: JSON.stringify(filesMetadata),
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
        setSubmissionType('text');
        setCodeLanguage('javascript');
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

  // Fetch multi-agent execution status — declared here so useEffects below can reference it
  const fetchMultiAgentStatus = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}/multi`);
      const data = await res.json();
      if (data.success && data.data) {
        setMultiAgentExecution(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch multi-agent status:', err);
    }
  }, [taskId]);

  // Fetch multi-agent execution status when task loads and has multi-agent enabled
  useEffect(() => {
    if (task?.multiAgentEnabled) {
      fetchMultiAgentStatus();
    }
  }, [task?.id, task?.multiAgentEnabled, fetchMultiAgentStatus]);

  // Poll multi-agent execution while it is active
  useEffect(() => {
    if (!task?.multiAgentEnabled) return;
    const activeStatuses = ['AGENTS_GENERATING', 'EVALUATING', 'REVISING'];
    if (!multiAgentExecution || !activeStatuses.includes(multiAgentExecution.status)) return;

    const interval = setInterval(fetchMultiAgentStatus, 10000);
    return () => clearInterval(interval);
  }, [task?.multiAgentEnabled, multiAgentExecution?.status, fetchMultiAgentStatus]);

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

  // Deposit escrow for multi-agent task (no bid required)
  const handleDepositEscrow = async () => {
    if (!task || !isCreator) return;
    setIsDepositingEscrow(true);
    try {
      const res = await fetch('/api/escrow/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, amount: task.reward }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'Failed to deposit escrow');

      toast({
        title: 'Escrow deposited!',
        description: result.execution
          ? `Multi-agent competition started with ${result.execution.agentCount} agents.`
          : 'Escrow locked. Multi-agent execution will start shortly.',
      });
      await refreshTask();
      await fetchMultiAgentStatus();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsDepositingEscrow(false);
    }
  };

  // Review Submission - approve, reject, or request revision
  const handleReviewSubmission = async (action: 'approve' | 'revise' | 'reject') => {
    const latestSubmission = submissions.filter(s => s.status === 'SUBMITTED').slice(-1)[0];
    if (!latestSubmission || !isCreator) return;

    if (action === 'revise' && !revisionFeedback.trim()) {
      toast({ title: 'Feedback required', description: 'Please enter revision feedback.', variant: 'destructive' });
      return;
    }

    setIsReviewing(true);
    try {
      const response = await fetch(`/api/submissions/${latestSubmission.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback: revisionFeedback || undefined }),
      });

      const result = await response.json();
      if (result.success) {
        const toastMap = {
          approve: { title: 'Submission Approved!', description: 'Task completed and escrow released.' },
          revise:  { title: 'Revision Requested',   description: 'Agent has been notified to revise.' },
          reject:  { title: 'Submission Rejected',  description: 'Task closed and escrow refunded.' },
        };
        toast(toastMap[action]);
        setRevisionFeedback('');
        setShowRevisionInput(false);
        refreshTask();
      } else {
        throw new Error(result.error || 'Failed to review submission');
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsReviewing(false);
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

  // Renders submission content formatted by type (markdown, code, URL, plain text)
  const SubmissionContentRenderer = ({ content, files }: { content: string; files?: string | null }) => {
    let meta: Record<string, string> = {};
    let extraFiles: { name: string }[] = [];
    if (files) {
      try {
        const parsed = JSON.parse(files);
        Object.entries(parsed).forEach(([k, v]) => {
          if (k.startsWith('_')) meta[k] = v as string;
          else extraFiles.push({ name: k });
        });
      } catch {}
    }

    const isUrl = meta._type === 'url' || (!meta._type && /^https?:\/\/\S+$/.test(content.trim()));

    if (isUrl) {
      const [rawUrl, ...rest] = content.split(/\n\n/);
      const desc = rest.join('\n\n').trim();
      return (
        <div className="space-y-2">
          <a
            href={rawUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline break-all"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {rawUrl.trim()}
          </a>
          {desc && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{desc}</p>}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="text-sm [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_h1]:font-bold [&_h1]:text-base [&_h2]:font-semibold [&_h2]:text-sm [&_a]:text-blue-600 [&_a]:underline [&_p]:mb-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground">
          <ReactMarkdown
            components={{
              code({ className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                return match ? (
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match[1]}
                    PreTag="div"
                    className="rounded-md text-xs"
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono" {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
        {extraFiles.length > 0 && (
          <div className="border-t pt-2 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Attached files</p>
            {extraFiles.map((f) => (
              <div key={f.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" />
                <span>{f.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

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

            {/* Escrow Deposit — Multi-Agent */}
            {(task as any).multiAgentEnabled && !hasEscrow && isCreator && (
              <Card className="border-purple-200 dark:border-purple-900 bg-purple-50 dark:bg-purple-950">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2 text-purple-800 dark:text-purple-200">
                    <Users className="h-4 w-4" />
                    Start Multi-Agent Competition
                  </CardTitle>
                  <CardDescription className="text-purple-700 dark:text-purple-300">
                    Deposit escrow to lock {task.reward} {task.tokenSymbol} and automatically start the competition between your selected agents.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={handleDepositEscrow}
                    disabled={isDepositingEscrow}
                    className="w-full gap-2 bg-purple-600 hover:bg-purple-700"
                  >
                    {isDepositingEscrow ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Coins className="h-4 w-4" />
                    )}
                    {isDepositingEscrow ? 'Depositing...' : `Deposit ${task.reward} ${task.tokenSymbol} & Start Competition`}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Escrow Status Warning — single-agent tasks only */}
            {task.status === 'IN_PROGRESS' && !hasEscrow && isCreator && !(task as any).multiAgentEnabled && (
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

            {/* Task FAILED with escrow split (max revisions reached) */}
            {task.status === 'FAILED' && hasEscrow && escrowStatus === 'RELEASED' && (
              <div className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-900 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-600" />
                  <span className="text-orange-800 dark:text-orange-200 font-medium">
                    Task failed after maximum revisions — escrow split
                  </span>
                </div>
                <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                  Agent received 80% ({(displayEscrowAmount * 0.8).toFixed(2)} {task.tokenSymbol}) for their work.
                  Creator refund: 20% ({(displayEscrowAmount * 0.2).toFixed(2)} {task.tokenSymbol}).
                </p>
              </div>
            )}

            {/* Escrow Released - Payment Complete */}
            {isEscrowReleased && task.status !== 'FAILED' && (
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

            {/* Multi-Agent Execution Panel */}
            {(task as any).multiAgentEnabled && multiAgentExecution && (() => {
              const exec = multiAgentExecution;
              const statusColors: Record<string, string> = {
                AGENTS_GENERATING: 'bg-blue-500',
                EVALUATING: 'bg-purple-500',
                REVISING: 'bg-yellow-500',
                COMPLETED: 'bg-green-500',
                FAILED: 'bg-red-500',
                PENDING: 'bg-gray-400',
              };
              const statusLabels: Record<string, string> = {
                AGENTS_GENERATING: 'Agents generating…',
                EVALUATING: 'Judge evaluating…',
                REVISING: 'Agents revising…',
                COMPLETED: 'Competition complete',
                FAILED: 'Execution failed',
                PENDING: 'Pending',
              };
              const activeStatuses = ['AGENTS_GENERATING', 'EVALUATING', 'REVISING'];
              const isActive = activeStatuses.includes(exec.status);
              const roundProgress = exec.maxRounds > 0 ? Math.round((exec.currentRound / exec.maxRounds) * 100) : 0;

              const selectionIcon: Record<string, React.ReactNode> = {
                WINNER_TAKE_ALL: <Trophy className="h-3.5 w-3.5" />,
                MERGED_OUTPUT: <GitMerge className="h-3.5 w-3.5" />,
                SPLIT_PAYMENT: <SplitSquareVertical className="h-3.5 w-3.5" />,
              };

              // Group evaluations by round
              const evalsByRound: Record<number, any[]> = {};
              (exec.evaluations || []).forEach((e: any) => {
                if (!evalsByRound[e.round]) evalsByRound[e.round] = [];
                evalsByRound[e.round].push(e);
              });
              const rounds = Object.keys(evalsByRound).map(Number).sort((a, b) => a - b);

              return (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        Multi-Agent Competition
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge className={`${statusColors[exec.status] || 'bg-gray-400'} text-white text-xs`}>
                          {isActive && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                          {statusLabels[exec.status] || exec.status}
                        </Badge>
                        {isActive && (
                          <Button variant="ghost" size="sm" onClick={fetchMultiAgentStatus} className="h-7 w-7 p-0">
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                      <span>Round {exec.currentRound}/{exec.maxRounds}</span>
                      <span>Stop at {exec.minScoreThreshold}/100</span>
                      <span className="flex items-center gap-1">{selectionIcon[exec.selectionMode]}{exec.selectionMode?.replace(/_/g, ' ')}</span>
                    </div>
                    <Progress value={roundProgress} className="h-1.5 mt-2" />
                  </CardHeader>
                  <CardContent className="space-y-4">

                    {/* Participants */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium flex items-center gap-2"><Bot className="h-4 w-4" />Agents</p>
                      <div className="grid grid-cols-1 gap-2">
                        {(exec.participants || []).map((p: any) => {
                          const isWinner = exec.winnerAgentId === p.agentId;
                          const statusColor: Record<string, string> = {
                            INVITED: 'secondary',
                            GENERATING: 'secondary',
                            WAITING_EVAL: 'secondary',
                            REVISING: 'secondary',
                            ELIMINATED: 'destructive',
                            COMPLETED: 'default',
                          };
                          return (
                            <div key={p.id} className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${isWinner ? 'border-green-500 bg-green-50 dark:bg-green-950' : ''}`}>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium truncate">{p.agentName}</span>
                                  {isWinner && <Trophy className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                                  <Badge variant={statusColor[p.status] as any || 'secondary'} className="text-xs shrink-0">{p.status}</Badge>
                                </div>
                                {p.rewardPercent != null && (
                                  <p className="text-xs text-muted-foreground mt-0.5">Reward: {p.rewardPercent.toFixed(1)}%</p>
                                )}
                              </div>
                              {p.bestScore != null && (
                                <div className="text-right shrink-0">
                                  <p className="text-lg font-bold leading-none">{p.bestScore}</p>
                                  <p className="text-xs text-muted-foreground">/100</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Winner / Merged Output */}
                    {exec.status === 'COMPLETED' && exec.mergedOutput && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium flex items-center gap-2"><GitMerge className="h-4 w-4" />Merged Output</p>
                        <div className="rounded-md bg-muted p-3 max-h-48 overflow-y-auto text-sm whitespace-pre-wrap">
                          {exec.mergedOutput}
                        </div>
                      </div>
                    )}

                    {/* Round evaluations */}
                    {rounds.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium flex items-center gap-2"><BarChart2 className="h-4 w-4" />Round Results</p>
                        <div className="space-y-2">
                          {rounds.map((round) => {
                            const evals = evalsByRound[round];
                            const isOpen = expandedRound === round;
                            return (
                              <div key={round} className="rounded-md border">
                                <button
                                  type="button"
                                  onClick={() => setExpandedRound(isOpen ? null : round)}
                                  className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
                                >
                                  <span>Round {round}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">{evals.length} eval{evals.length !== 1 ? 's' : ''}</span>
                                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  </div>
                                </button>
                                {isOpen && (
                                  <div className="border-t px-3 py-2 space-y-3">
                                    {evals.sort((a: any, b: any) => (b.overallScore ?? 0) - (a.overallScore ?? 0)).map((e: any) => {
                                      const participant = (exec.participants || []).find((p: any) => p.agentId === e.agentId);
                                      return (
                                        <div key={e.id} className={`text-sm space-y-1 ${e.isBestInRound ? 'text-green-700 dark:text-green-400' : ''}`}>
                                          <div className="flex items-center justify-between">
                                            <span className="font-medium">{participant?.agentName || e.agentId.slice(0, 8)}</span>
                                            <div className="flex items-center gap-2">
                                              {e.isBestInRound && <Trophy className="h-3.5 w-3.5 text-yellow-500" />}
                                              <span className="font-bold">{e.overallScore ?? '—'}/100</span>
                                            </div>
                                          </div>
                                          {e.feedback && (
                                            <p className="text-xs text-muted-foreground leading-snug">{e.feedback}</p>
                                          )}
                                          {e.eliminationReason && (
                                            <p className="text-xs text-destructive">Eliminated: {e.eliminationReason}</p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Waiting message when no evaluations yet */}
                    {rounds.length === 0 && isActive && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Waiting for agents to submit their first round…
                      </div>
                    )}

                    {exec.totalCost > 0 && (
                      <p className="text-xs text-muted-foreground">Judge cost: ${exec.totalCost.toFixed(4)}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Multi-Agent — waiting for escrow */}
            {(task as any).multiAgentEnabled && hasEscrow && !multiAgentExecution && (
              <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-900 rounded-lg p-4 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                <span className="text-purple-800 dark:text-purple-200 text-sm">
                  Starting multi-agent competition…
                </span>
              </div>
            )}

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
                  {/* Submission type selector */}
                  <div>
                    <label className="text-sm font-medium">Submission Type</label>
                    <div className="flex gap-2 mt-1">
                      {(['text', 'code', 'url'] as const).map((type) => (
                        <Button
                          key={type}
                          type="button"
                          size="sm"
                          variant={submissionType === type ? 'default' : 'outline'}
                          onClick={() => setSubmissionType(type)}
                          className="gap-1"
                        >
                          {type === 'code' && <Code2 className="h-3 w-3" />}
                          {type === 'url' && <Link className="h-3 w-3" />}
                          {type === 'text' && <FileText className="h-3 w-3" />}
                          {type === 'text' ? 'Description' : type === 'url' ? 'URL / Link' : 'Code'}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Code: language selector */}
                  {submissionType === 'code' && (
                    <div>
                      <label className="text-sm font-medium">Language</label>
                      <Select value={codeLanguage} onValueChange={setCodeLanguage}>
                        <SelectTrigger className="mt-1 w-full">
                          <SelectValue placeholder="Select language" />
                        </SelectTrigger>
                        <SelectContent>
                          {['python', 'javascript', 'typescript', 'bash', 'sql', 'json', 'html', 'css', 'rust', 'go'].map((lang) => (
                            <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* URL type: URL field + optional description */}
                  {submissionType === 'url' ? (
                    <>
                      <div>
                        <label className="text-sm font-medium">URL</label>
                        <Input
                          value={resultUri}
                          onChange={(e) => setResultUri(e.target.value)}
                          placeholder="https://..."
                          type="url"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">
                          Description <span className="text-muted-foreground font-normal">(optional)</span>
                        </label>
                        <Textarea
                          value={workContent}
                          onChange={(e) => setWorkContent(e.target.value)}
                          placeholder="Brief description of what this link contains..."
                          rows={2}
                          className="mt-1"
                        />
                      </div>
                    </>
                  ) : (
                    /* Text / Code: single textarea */
                    <div>
                      <label className="text-sm font-medium">
                        {submissionType === 'code' ? 'Code' : 'Work Description'}
                      </label>
                      {submissionType === 'text' && (
                        <p className="text-xs text-muted-foreground mt-0.5">Markdown is supported.</p>
                      )}
                      <Textarea
                        value={workContent}
                        onChange={(e) => setWorkContent(e.target.value)}
                        placeholder={
                          submissionType === 'code'
                            ? `Paste your ${codeLanguage} code here...`
                            : 'Describe the work you have completed...'
                        }
                        rows={submissionType === 'code' ? 8 : 4}
                        className={
                          submissionType === 'code'
                            ? 'mt-1 font-mono text-sm'
                            : 'mt-1'
                        }
                        spellCheck={submissionType !== 'code'}
                      />
                    </div>
                  )}

                  <Button
                    onClick={handleSubmitWork}
                    disabled={isSubmittingWork || (submissionType === 'url' ? !resultUri.trim() : !workContent.trim())}
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

            {/* Submission Review - IN_REVIEW flow (new revision system) */}
            {task.status === 'IN_REVIEW' && (() => {
              const latestSubmission = submissions.filter(s => s.status === 'SUBMITTED').slice(-1)[0];
              if (!latestSubmission) return null;
              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Submission v{latestSubmission.version}
                    </CardTitle>
                    <CardDescription>
                      Submitted by agent — review and approve or request changes
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-3 bg-muted rounded-lg max-h-64 overflow-y-auto">
                      <SubmissionContentRenderer
                        content={latestSubmission.content}
                        files={latestSubmission.files}
                      />
                    </div>

                    {submissions.length > 1 && (
                      <p className="text-xs text-muted-foreground">
                        {submissions.length} submission{submissions.length > 1 ? 's' : ''} total (revision {submissions.length - 1})
                      </p>
                    )}

                    {isCreator && (
                      <div className="space-y-2">
                        {showRevisionInput ? (
                          <>
                            <Textarea
                              value={revisionFeedback}
                              onChange={(e) => setRevisionFeedback(e.target.value)}
                              placeholder="Describe what needs to be changed..."
                              rows={3}
                            />
                            <div className="flex gap-2">
                              <Button
                                onClick={() => handleReviewSubmission('revise')}
                                disabled={isReviewing || !revisionFeedback.trim()}
                                variant="outline"
                                className="flex-1 gap-2"
                              >
                                {isReviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                                Request Revision
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => { setShowRevisionInput(false); setRevisionFeedback(''); }}
                                disabled={isReviewing}
                              >
                                Cancel
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleReviewSubmission('approve')}
                              disabled={isReviewing}
                              className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                            >
                              {isReviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                              Approve
                            </Button>
                            <Button
                              onClick={() => handleReviewSubmission('reject')}
                              disabled={isReviewing}
                              variant="destructive"
                              className="flex-1 gap-2"
                            >
                              {isReviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                              Reject
                            </Button>
                            <Button
                              onClick={() => setShowRevisionInput(true)}
                              disabled={isReviewing}
                              variant="outline"
                              className="flex-1 gap-2"
                            >
                              <XCircle className="h-4 w-4" />
                              Request Revision
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Submission History (when there are multiple versions) */}
            {submissions.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Submission History
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {submissions.map((sub) => (
                    <div key={sub.id} className="border rounded-lg p-3 text-sm space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Version {sub.version}</span>
                        <Badge variant={sub.status === 'APPROVED' ? 'default' : sub.status === 'REVISION_REQUESTED' ? 'destructive' : 'secondary'}>
                          {sub.status}
                        </Badge>
                      </div>
                      {sub.content && (
                        <p className="text-xs text-muted-foreground truncate" title={sub.content}>
                          {sub.content.slice(0, 100)}{sub.content.length > 100 ? '…' : ''}
                        </p>
                      )}
                      {sub.feedback && (
                        <p className="text-muted-foreground text-xs">Feedback: {sub.feedback}</p>
                      )}
                    </div>
                  ))}
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
                {(task as any).multiAgentEnabled && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Multi-Agent</span>
                    <span className="font-medium text-purple-600">
                      {multiAgentExecution
                        ? `Round ${multiAgentExecution.currentRound}/${multiAgentExecution.maxRounds} · ${multiAgentExecution.status}`
                        : hasEscrow ? 'Starting…' : 'Awaiting escrow'}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t text-xs text-muted-foreground">
                  {(task as any).multiAgentEnabled ? (
                    <>
                      <p>✓ Task: Database only</p>
                      <p>✓ Deposit Escrow: Auto-starts competition</p>
                      <p>✓ Agents compete over {multiAgentExecution?.maxRounds ?? '?'} rounds</p>
                      <p>✓ Release: approveAndRelease() on-chain</p>
                    </>
                  ) : (
                    <>
                      <p>✓ Task & Bids: Database only</p>
                      <p>✓ Accept Bid: depositEscrow() on-chain</p>
                      <p>✓ Complete: Database only (requires escrow)</p>
                      <p>✓ Release: approveAndRelease() on-chain</p>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
