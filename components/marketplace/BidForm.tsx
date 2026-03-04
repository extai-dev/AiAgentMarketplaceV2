'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAccount } from 'wagmi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useStore, Task } from '@/store/useStore';
import { useToast } from '@/hooks/use-toast';
import { 
  Coins, 
  Loader2, 
  Send,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';

const bidSchema = z.object({
  amount: z.string().min(1, 'Amount is required').refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
    message: 'Amount must be a positive number',
  }),
  message: z.string().min(10, 'Message must be at least 10 characters').max(500, 'Message too long'),
});

type BidFormData = z.infer<typeof bidSchema>;

interface BidFormProps {
  task: Task;
  onBidSubmitted?: () => void;
}

export function BidForm({ task, onBidSubmitted }: BidFormProps) {
  const { address, isConnected } = useAccount();
  const { user, setUser } = useStore();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  const form = useForm<BidFormData>({
    resolver: zodResolver(bidSchema),
    defaultValues: {
      amount: task.reward.toString(),
      message: '',
    },
  });

  // Check if user is the creator
  const isCreator = address?.toLowerCase() === task.creator?.walletAddress?.toLowerCase();

  // Check if task is open
  const isOpen = task.status === 'OPEN';

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
              name: 'Agent',
              role: 'agent'
            }),
          });
          const result = await response.json();
          if (result.success) {
            setUser(result.data);
          }
        } catch (error) {
          console.error('Failed to create user:', error);
        } finally {
          setIsCreatingUser(false);
        }
      }
    };
    createUser();
  }, [isConnected, address, user, setUser, isCreatingUser]);

  const onSubmit = async (data: BidFormData) => {
    if (!isConnected || !address) {
      toast({
        title: 'Error',
        description: 'Please connect your wallet first',
        variant: 'destructive',
      });
      return;
    }

    if (isCreator) {
      toast({
        title: 'Error',
        description: 'You cannot bid on your own task',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Submit bid to database - pass wallet address, API will find/create user
      const response = await fetch(`/api/tasks/${task.id}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentWalletAddress: address, // Pass wallet address - API will find/create user
          amount: parseFloat(data.amount),
          message: data.message,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Bid Submitted!',
          description: 'Your bid has been submitted successfully.',
        });
        form.reset();
        onBidSubmitted?.();
      } else {
        throw new Error(result.error || 'Failed to submit bid');
      }
    } catch (error: any) {
      console.error('Error submitting bid:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to submit bid',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">Connect wallet to place a bid</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isCreator) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">You cannot bid on your own task</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isOpen) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">This task is not accepting bids</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Place a Bid
        </CardTitle>
        <CardDescription>
          Submit your proposal for this task
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Wallet Connected Status */}
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-sm text-green-800 dark:text-green-200">
              Wallet connected: {address?.slice(0, 6)}...{address?.slice(-4)}
            </span>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bid Amount ({task.tokenSymbol})</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={task.reward.toString()}
                        className="pl-10"
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Your proposed compensation for completing this task
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proposal Message</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Explain why you're the best fit for this task, your approach, and estimated completion time..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Describe your qualifications and approach
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Submit Bid
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
