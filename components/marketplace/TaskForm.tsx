'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAccount, useReadContract, useSwitchChain } from 'wagmi';
import { type Address } from 'viem';
import { polygonAmoy } from 'wagmi/chains';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/store/useStore';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ERC20_ABI, TASK_TOKEN_ADDRESS } from '@/lib/contracts/addresses';
import {
  CalendarIcon,
  Loader2,
  Coins,
  FileText,
  AlertCircle,
  CheckCircle2,
  Info,
  Users,
  Trophy,
  GitMerge,
  SplitSquareVertical,
  Bot,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const taskSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(100, 'Title too long'),
  description: z.string().min(10, 'Description must be at least 10 characters').max(2000, 'Description too long'),
  reward: z.string().min(1, 'Reward is required').refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
    message: 'Reward must be a positive number',
  }),
  deadline: z.date().optional(),
  tokenSymbol: z.string(),
});

type TaskFormData = z.infer<typeof taskSchema>;

interface AgentOption {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  capabilities?: string;
}

type SelectionMode = 'WINNER_TAKE_ALL' | 'MERGED_OUTPUT' | 'SPLIT_PAYMENT';

interface TaskFormProps {
  onSuccess?: (taskId: string) => void;
}

// Check if address is valid (not zero address)
const isValidAddress = (addr: string | undefined): addr is Address => {
  return !!addr && addr !== '0x0000000000000000000000000000000000000000';
};

const SELECTION_MODES: { value: SelectionMode; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'WINNER_TAKE_ALL',
    label: 'Winner Takes All',
    description: 'Highest-scoring agent receives the full reward',
    icon: <Trophy className="h-4 w-4" />,
  },
  {
    value: 'MERGED_OUTPUT',
    label: 'Merged Output',
    description: 'Judge combines the top submissions into a final output',
    icon: <GitMerge className="h-4 w-4" />,
  },
  {
    value: 'SPLIT_PAYMENT',
    label: 'Split Payment',
    description: 'Reward split proportionally among top performers',
    icon: <SplitSquareVertical className="h-4 w-4" />,
  },
];

const JUDGE_MODELS = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'gemini' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', provider: 'anthropic' },
];

export function TaskForm({ onSuccess }: TaskFormProps) {
  const router = useRouter();
  const { address, isConnected, chain } = useAccount();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const { user, setUser, addTask } = useStore();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [step, setStep] = useState<'form' | 'saving' | 'done'>('form');

  // Multi-agent state
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [maxRounds, setMaxRounds] = useState(3);
  const [minScoreThreshold, setMinScoreThreshold] = useState(70);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('WINNER_TAKE_ALL');
  const [judgeModel, setJudgeModel] = useState('gemini-2.0-flash');
  const [agentSectionOpen, setAgentSectionOpen] = useState(true);

  const userIdRef = useRef<string | null>(null);

  const tokenAddress = TASK_TOKEN_ADDRESS as Address;
  const isCorrectNetwork = chain?.id === 80002; // Polygon Amoy
  const hasContracts = isValidAddress(tokenAddress);

  // Read token balance
  const { data: tokenBalance, refetch: refetchBalance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!tokenAddress && !!address,
    },
  });

  // Create user when wallet connects
  useEffect(() => {
    const createUser = async () => {
      if (isConnected && address && !user && !isCreatingUser) {
        setIsCreatingUser(true);
        try {
          const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              walletAddress: address,
              name: 'User',
              role: 'user'
            }),
          });
          const result = await response.json();
          if (result.success) {
            setUser(result.data);
            userIdRef.current = result.data.id;
          }
        } catch (error) {
          console.error('Failed to create user:', error);
        } finally {
          setIsCreatingUser(false);
        }
      } else if (user?.id) {
        userIdRef.current = user.id;
      }
    };
    createUser();
  }, [isConnected, address, user, setUser, isCreatingUser]);

  // Fetch active agents when multi-agent is toggled on
  useEffect(() => {
    if (!multiAgentEnabled || agents.length > 0) return;
    const fetchAgents = async () => {
      setAgentsLoading(true);
      try {
        const res = await fetch('/api/agents?status=ACTIVE&limit=50');
        const result = await res.json();
        if (result.success) {
          setAgents(result.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch agents:', err);
      } finally {
        setAgentsLoading(false);
      }
    };
    fetchAgents();
  }, [multiAgentEnabled, agents.length]);

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      reward: '',
      tokenSymbol: 'TT',
    },
  });

  const handleSwitchNetwork = async () => {
    try {
      await switchChainAsync({ chainId: polygonAmoy.id });
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  };

  // Mint test tokens using backend faucet
  const handleMintTokens = async () => {
    if (!address) return;

    try {
      toast({
        title: 'Getting test tokens...',
        description: 'Please wait while we mint tokens to your wallet.',
      });

      const response = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Tokens minted!',
          description: result.data.message,
        });
        refetchBalance();
      } else {
        throw new Error(result.error || 'Failed to mint tokens');
      }
    } catch (error: any) {
      console.error('Mint error:', error);
      toast({
        title: 'Failed to get tokens',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : prev.length < 5
        ? [...prev, agentId]
        : prev
    );
  };

  const onSubmit = async (data: TaskFormData) => {
    // Validate multi-agent config before submission
    if (multiAgentEnabled && selectedAgentIds.length < 2) {
      toast({
        title: 'Select at least 2 agents',
        description: 'Multi-agent mode requires a minimum of 2 agents.',
        variant: 'destructive',
      });
      return;
    }

    setStep('saving');
    setIsSubmitting(true);

    try {
      // Ensure user exists
      if (!userIdRef.current) {
        const guestAddress = address || `0xguest${Date.now().toString(16).padStart(34, '0')}`;
        const userResponse = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: guestAddress,
            name: isConnected ? 'Connected User' : 'Guest User',
            role: 'user'
          }),
        });
        const userResult = await userResponse.json();
        if (userResult.success) {
          setUser(userResult.data);
          userIdRef.current = userResult.data.id;
        } else {
          throw new Error('Failed to create user profile');
        }
      }

      const selectedJudge = JUDGE_MODELS.find((m) => m.value === judgeModel);

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          reward: parseFloat(data.reward),
          tokenSymbol: data.tokenSymbol,
          creatorWalletAddress: address,
          deadline: data.deadline?.toISOString(),
          multiAgentEnabled,
          ...(multiAgentEnabled && {
            minAgentsRequired: 2,
            maxAgentsAllowed: 5,
            multiAgentConfig: {
              agentIds: selectedAgentIds,
              maxRounds,
              minScoreThreshold,
              selectionMode,
              judgeModel,
              judgeProvider: selectedJudge?.provider ?? 'gemini',
            },
          }),
        }),
      });

      const result = await response.json();
      console.log('DB response:', result);

      if (!response.ok || !result.success) {
        throw new Error(result.error || `Server error: ${response.status}`);
      }

      addTask(result.data);

      if (multiAgentEnabled) {
        toast({
          title: 'Task created with multi-agent competition!',
          description: `${selectedAgentIds.length} agents will compete over up to ${maxRounds} rounds. Deposit escrow to start execution.`,
        });
      } else {
        toast({
          title: 'Task created successfully!',
          description: 'Your task is now live. Deposit escrow when you accept a bid.',
        });
      }

      setStep('done');

      if (onSuccess) {
        onSuccess(result.data.id);
      } else {
        router.push(`/tasks/${result.data.id}`);
      }
    } catch (error: any) {
      console.error('Error creating task:', error);
      toast({
        title: 'Error creating task',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
      setIsSubmitting(false);
      setStep('form');
    }
  };

  const tokenBalanceFormatted = tokenBalance
    ? (Number(tokenBalance as bigint) / 1e18).toFixed(2)
    : '0';

  const rewardValue = parseFloat(form.watch('reward') || '0');
  const isRewardSufficientForMultiAgent = rewardValue >= 50;

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Post a New Task
        </CardTitle>
        <CardDescription>
          Create a task for AI agents to complete. Task creation is free - escrow is deposited when you accept a bid.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Status Messages */}
            {isConnected ? (
              <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-900">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-800 dark:text-green-200">Wallet Connected</AlertTitle>
                <AlertDescription className="text-green-700 dark:text-green-300">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                  {hasContracts && ` • TT Balance: ${tokenBalanceFormatted}`}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-900">
                <Info className="h-4 w-4 text-yellow-600" />
                <AlertTitle className="text-yellow-800 dark:text-yellow-200">Connect Wallet</AlertTitle>
                <AlertDescription className="text-yellow-700 dark:text-yellow-300">
                  Connect your wallet to create tasks and deposit escrow.
                </AlertDescription>
              </Alert>
            )}

            {/* Network Warning */}
            {isConnected && !isCorrectNetwork && (
              <Alert className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-900">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertTitle className="text-orange-800 dark:text-orange-200">Wrong Network</AlertTitle>
                <AlertDescription className="text-orange-700 dark:text-orange-300">
                  <div className="flex items-center justify-between">
                    <span>Please switch to Polygon Amoy testnet for escrow operations.</span>
                    <Button
                      size="sm"
                      onClick={handleSwitchNetwork}
                      disabled={isSwitchingChain}
                    >
                      {isSwitchingChain ? 'Switching...' : 'Switch Network'}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Low Balance Warning */}
            {isConnected && hasContracts && parseFloat(tokenBalanceFormatted) < 10 && (
              <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-900">
                <Coins className="h-4 w-4 text-blue-600" />
                <AlertTitle className="text-blue-800 dark:text-blue-200">Get Test Tokens</AlertTitle>
                <AlertDescription className="text-blue-700 dark:text-blue-300">
                  <div className="flex items-center justify-between">
                    <span>You'll need TT tokens to deposit escrow when accepting bids.</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleMintTokens}
                    >
                      Get 1000 TT (Free)
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Saving Status */}
            {step === 'saving' && (
              <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-900">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <AlertTitle className="text-blue-800 dark:text-blue-200">
                  Creating task...
                </AlertTitle>
              </Alert>
            )}

            {/* Step 1: Basic Info */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                  1
                </div>
                Basic Information
              </div>

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Task Title *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Analyze customer feedback data" {...field} />
                    </FormControl>
                    <FormDescription>
                      A clear, concise title for your task
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe the task in detail. Include requirements, expected output format, and any relevant context..."
                        className="min-h-[120px]"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Detailed instructions for AI agents
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Step 2: Reward & Deadline */}
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                  2
                </div>
                Reward & Timeline
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="reward"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reward Amount (TT) *</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="10.00"
                            className="pl-10"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Your balance: {tokenBalanceFormatted} TT
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tokenSymbol"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Token</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select token" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="TT">TT (TaskToken)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Payment token
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="deadline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deadline (Optional)</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value ? (
                              format(field.value, 'PPP')
                            ) : (
                              <span>Pick a deadline</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => date < new Date()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription>
                      Default: 7 days from now
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Step 3: Multi-Agent Competition */}
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                    3
                  </div>
                  Multi-Agent Competition
                  <Badge variant="secondary" className="text-xs">Optional</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {multiAgentEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <Switch
                    checked={multiAgentEnabled}
                    onCheckedChange={(checked) => {
                      setMultiAgentEnabled(checked);
                      if (!checked) setSelectedAgentIds([]);
                    }}
                  />
                </div>
              </div>

              {!multiAgentEnabled && (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground flex items-start gap-3">
                  <Users className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground mb-1">Invite multiple agents to compete</p>
                    <p>2–5 agents submit solutions in parallel, evaluated by an LLM judge over multiple rounds. The best submission wins — or outputs are merged.</p>
                    <p className="mt-1 text-xs">Recommended for reward ≥ 50 TT</p>
                  </div>
                </div>
              )}

              {multiAgentEnabled && (
                <div className="space-y-5 rounded-lg border p-4">

                  {/* Reward warning */}
                  {!isRewardSufficientForMultiAgent && rewardValue > 0 && (
                    <Alert className="py-2 border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-900">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      <AlertDescription className="text-amber-700 dark:text-amber-300 text-sm">
                        Reward is below 50 TT — multi-agent mode works best for higher-value tasks.
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Agent Selection */}
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setAgentSectionOpen((v) => !v)}
                      className="flex w-full items-center justify-between text-sm font-medium"
                    >
                      <span className="flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        Select Competing Agents
                        <Badge variant={selectedAgentIds.length >= 2 ? 'default' : 'secondary'} className="text-xs">
                          {selectedAgentIds.length}/5 selected
                        </Badge>
                      </span>
                      {agentSectionOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    {agentSectionOpen && (
                      <div className="space-y-2">
                        {agentsLoading ? (
                          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading active agents...
                          </div>
                        ) : agents.length === 0 ? (
                          <div className="rounded-md border border-dashed py-4 text-center text-sm text-muted-foreground">
                            No active agents found. Register agents first.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1">
                            {agents.map((agent) => {
                              const isSelected = selectedAgentIds.includes(agent.id);
                              const isDisabled = !isSelected && selectedAgentIds.length >= 5;
                              return (
                                <button
                                  key={agent.id}
                                  type="button"
                                  disabled={isDisabled}
                                  onClick={() => toggleAgent(agent.id)}
                                  className={cn(
                                    'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors',
                                    isSelected
                                      ? 'border-primary bg-primary/5'
                                      : 'hover:bg-muted/50',
                                    isDisabled && 'cursor-not-allowed opacity-40'
                                  )}
                                >
                                  <div className={cn(
                                    'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                                    isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
                                  )}>
                                    {isSelected && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium truncate">{agent.name}</span>
                                      <Badge
                                        variant={agent.status === 'ACTIVE' ? 'default' : 'secondary'}
                                        className="text-xs shrink-0"
                                      >
                                        {agent.status}
                                      </Badge>
                                    </div>
                                    {agent.description && (
                                      <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.description}</p>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {selectedAgentIds.length > 0 && selectedAgentIds.length < 2 && (
                          <p className="text-xs text-destructive">Select at least 2 agents to enable competition</p>
                        )}
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Rounds & Score Threshold */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Max Rounds</label>
                      <div className="flex items-center gap-3">
                        <Slider
                          min={1}
                          max={6}
                          step={1}
                          value={[maxRounds]}
                          onValueChange={([v]) => setMaxRounds(v)}
                          className="flex-1"
                        />
                        <span className="w-6 text-sm font-medium text-center">{maxRounds}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Agents refine their submissions each round</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Early Stop Score</label>
                      <div className="flex items-center gap-3">
                        <Slider
                          min={50}
                          max={100}
                          step={5}
                          value={[minScoreThreshold]}
                          onValueChange={([v]) => setMinScoreThreshold(v)}
                          className="flex-1"
                        />
                        <span className="w-8 text-sm font-medium text-center">{minScoreThreshold}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Stop early when any agent reaches this score</p>
                    </div>
                  </div>

                  <Separator />

                  {/* Selection Mode */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Selection Mode</label>
                    <RadioGroup
                      value={selectionMode}
                      onValueChange={(v) => setSelectionMode(v as SelectionMode)}
                      className="grid grid-cols-1 gap-2"
                    >
                      {SELECTION_MODES.map((mode) => (
                        <div key={mode.value} className="flex items-start space-x-3">
                          <RadioGroupItem
                            value={mode.value}
                            id={`mode-${mode.value}`}
                            className="mt-0.5"
                          />
                          <label
                            htmlFor={`mode-${mode.value}`}
                            className="flex-1 cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5 text-sm font-medium">
                              {mode.icon}
                              {mode.label}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{mode.description}</p>
                          </label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>

                  <Separator />

                  {/* Judge Model */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Judge Model</label>
                    <Select value={judgeModel} onValueChange={setJudgeModel}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {JUDGE_MODELS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">LLM used to score and rank agent submissions</p>
                  </div>

                  {/* Summary */}
                  {selectedAgentIds.length >= 2 && (
                    <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
                      <p className="font-medium text-foreground text-sm">Competition summary</p>
                      <p>{selectedAgentIds.length} agents · up to {maxRounds} rounds · stop at {minScoreThreshold}/100</p>
                      <p>{SELECTION_MODES.find(m => m.value === selectionMode)?.label} · judged by {JUDGE_MODELS.find(m => m.value === judgeModel)?.label}</p>
                      <p className="mt-1">Execution starts automatically after escrow is deposited.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/')}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || (multiAgentEnabled && selectedAgentIds.length < 2)}
                className="min-w-[140px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    {multiAgentEnabled ? <Users className="mr-2 h-4 w-4" /> : <FileText className="mr-2 h-4 w-4" />}
                    {multiAgentEnabled ? 'Create Competition' : 'Create Task'}
                  </>
                )}
              </Button>
            </div>

            {/* Info */}
            <div className="text-xs text-muted-foreground text-center space-y-1">
              {multiAgentEnabled ? (
                <p>
                  ✅ Task creation is free
                  <br />🤖 {selectedAgentIds.length >= 2 ? `${selectedAgentIds.length} agents` : 'Agents'} compete over {maxRounds} rounds
                  <br />💰 Deposit escrow to auto-start the competition
                </p>
              ) : (
                <p>
                  ✅ Task creation is free (database only)
                  <br />💰 Deposit escrow when you accept a bid
                </p>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
