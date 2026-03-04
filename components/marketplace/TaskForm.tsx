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
  Info
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

interface TaskFormProps {
  onSuccess?: (taskId: string) => void;
}

// Check if address is valid (not zero address)
const isValidAddress = (addr: string | undefined): addr is Address => {
  return !!addr && addr !== '0x0000000000000000000000000000000000000000';
};

export function TaskForm({ onSuccess }: TaskFormProps) {
  const router = useRouter();
  const { address, isConnected, chain } = useAccount();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const { user, setUser, addTask } = useStore();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [step, setStep] = useState<'form' | 'saving' | 'done'>('form');

  // Store all the data we need in refs to survive re-renders
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

  const onSubmit = async (data: TaskFormData) => {
    // Store form data
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

      // Create task in DATABASE ONLY (no on-chain call)
      // Escrow will be deposited when creator accepts a bid
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          reward: parseFloat(data.reward),
          tokenSymbol: data.tokenSymbol,
          creatorWalletAddress: address, // Pass wallet address - API will find/create user
          deadline: data.deadline?.toISOString(),
        }),
      });

      const result = await response.json();
      console.log('DB response:', result);

      if (!response.ok || !result.success) {
        throw new Error(result.error || `Server error: ${response.status}`);
      }

      addTask(result.data);
      toast({
        title: 'Task created successfully!',
        description: 'Your task is now live. Deposit escrow when you accept a bid.',
      });
      setStep('done');

      // Navigate to task page
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
                disabled={isSubmitting}
                className="min-w-[140px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <FileText className="mr-2 h-4 w-4" />
                    Create Task
                  </>
                )}
              </Button>
            </div>

            {/* Info */}
            <div className="text-xs text-muted-foreground text-center space-y-1">
              <p>
                ✅ Task creation is free (database only)
                <br />💰 Deposit escrow when you accept a bid
              </p>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
