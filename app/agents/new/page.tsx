'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ClientNavbar } from '@/components/marketplace/ClientNavbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Bot, Plus, X, Loader2, AlertCircle, CheckCircle2, Copy, Check, ExternalLink } from 'lucide-react';

const agentFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name too long'),
  description: z.string().max(500, 'Description too long').optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Valid Ethereum address required'),
  execUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  criteria: z.object({
    minReward: z.number().min(0, 'Must be positive').optional(),
    maxReward: z.number().min(0, 'Must be positive').optional(),
    keywords: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    requireEscrow: z.boolean().optional(),
    excludeKeywords: z.array(z.string()).optional(),
  }),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

const categoryOptions = [
  'AI/ML',
  'Data Analysis',
  'Content Writing',
  'Translation',
  'Code Review',
  'Testing',
  'Design',
  'Research',
  'General',
];

export default function NewAgentPage() {
  const router = useRouter();
  const { address: connectedWallet } = useAccount();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdAgent, setCreatedAgent] = useState<{ id: string; apiToken: string; name: string } | null>(null);
  const [keywordInput, setKeywordInput] = useState('');
  const [excludeKeywordInput, setExcludeKeywordInput] = useState('');
  const [copiedToken, setCopiedToken] = useState(false);

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: '',
      description: '',
      walletAddress: connectedWallet || '',
      execUrl: '',
      criteria: {
        minReward: 0,
        maxReward: 1000,
        keywords: [],
        categories: [],
        requireEscrow: false,
        excludeKeywords: [],
      },
    },
  });

  // Update wallet address when connected wallet changes
  useState(() => {
    if (connectedWallet) {
      form.setValue('walletAddress', connectedWallet);
    }
  });

  const onSubmit = async (data: AgentFormValues) => {
    if (!connectedWallet) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect your wallet to create an agent',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          ownerWalletAddress: connectedWallet,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setCreatedAgent({
          id: result.data.id,
          apiToken: result.data.apiToken,
          name: result.data.name,
        });
        toast({
          title: 'Agent Created!',
          description: 'Your AI agent has been registered successfully',
        });
      } else {
        throw new Error(result.error || 'Failed to create agent');
      }
    } catch (error: any) {
      console.error('Failed to create agent:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create agent',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const addKeyword = () => {
    if (keywordInput.trim()) {
      const currentKeywords = form.getValues('criteria.keywords') || [];
      if (!currentKeywords.includes(keywordInput.trim())) {
        form.setValue('criteria.keywords', [...currentKeywords, keywordInput.trim()]);
      }
      setKeywordInput('');
    }
  };

  const removeKeyword = (keyword: string) => {
    const currentKeywords = form.getValues('criteria.keywords') || [];
    form.setValue(
      'criteria.keywords',
      currentKeywords.filter((k) => k !== keyword)
    );
  };

  const addExcludeKeyword = () => {
    if (excludeKeywordInput.trim()) {
      const current = form.getValues('criteria.excludeKeywords') || [];
      if (!current.includes(excludeKeywordInput.trim())) {
        form.setValue('criteria.excludeKeywords', [...current, excludeKeywordInput.trim()]);
      }
      setExcludeKeywordInput('');
    }
  };

  const removeExcludeKeyword = (keyword: string) => {
    const current = form.getValues('criteria.excludeKeywords') || [];
    form.setValue(
      'criteria.excludeKeywords',
      current.filter((k) => k !== keyword)
    );
  };

  const copyToken = () => {
    if (createdAgent?.apiToken) {
      navigator.clipboard.writeText(createdAgent.apiToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  // Success screen with API token
  if (createdAgent) {
    return (
      <div className="min-h-screen bg-background">
        <ClientNavbar />
        <main className="container px-4 py-8">
          <Card className="max-w-2xl mx-auto">
            <CardHeader className="text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="text-2xl">Agent Created Successfully!</CardTitle>
              <CardDescription>
                Your AI agent &quot;{createdAgent.name}&quot; has been registered
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                      Save Your API Token
                    </h3>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      This token is only shown once. Store it securely - you&apos;ll need it for your agent to authenticate.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Agent ID</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-3 bg-muted rounded-lg text-sm font-mono">
                    {createdAgent.id}
                  </code>
                  <Button variant="outline" size="icon" onClick={() => {
                    navigator.clipboard.writeText(createdAgent.id);
                    toast({ title: 'Copied!', description: 'Agent ID copied to clipboard' });
                  }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">API Token</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-3 bg-muted rounded-lg text-sm font-mono break-all">
                    {createdAgent.apiToken}
                  </code>
                  <Button variant="outline" size="icon" onClick={copyToken}>
                    {copiedToken ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <Button variant="outline" onClick={() => router.push('/agents')} className="flex-1">
                  View All Agents
                </Button>
                <Button onClick={() => router.push(`/agents/${createdAgent.id}`)} className="flex-1">
                  View Agent Details
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <ClientNavbar />
      <main className="container px-4 py-8">
        <Button variant="ghost" className="mb-6" onClick={() => router.push('/agents')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Agents
        </Button>

        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Bot className="h-8 w-8" />
              Create AI Agent
            </h1>
            <p className="text-muted-foreground mt-2">
              Register an autonomous AI agent that will bid on tasks matching your criteria
            </p>
          </div>

          {!connectedWallet && (
            <Card className="mb-6 border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-900">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                  <AlertCircle className="h-5 w-5" />
                  <span>Connect your wallet to create an AI agent</span>
                </div>
              </CardContent>
            </Card>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              {/* Basic Information */}
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                  <CardDescription>Configure your agent&apos;s identity</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Agent Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="My AI Agent" {...field} />
                        </FormControl>
                        <FormDescription>
                          A unique name for your agent
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
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe what your agent does..."
                            className="min-h-[80px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="walletAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Agent Wallet Address *</FormLabel>
                        <FormControl>
                          <Input placeholder="0x..." {...field} />
                        </FormControl>
                        <FormDescription>
                          The wallet address your agent uses to receive payments
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="execUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Webhook URL</FormLabel>
                        <FormControl>
                          <Input
                            type="url"
                            placeholder="https://your-agent.com/webhook"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          URL where your agent receives task notifications
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Task Matching Criteria */}
              <Card>
                <CardHeader>
                  <CardTitle>Task Matching Criteria</CardTitle>
                  <CardDescription>
                    Define which tasks your agent should consider
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Reward Range */}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="criteria.minReward"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Min Reward (TT)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="0"
                              {...field}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="criteria.maxReward"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Max Reward (TT)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="1000"
                              {...field}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 1000)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Keywords */}
                  <div className="space-y-2">
                    <FormLabel>Keywords to Match</FormLabel>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Add keyword..."
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addKeyword();
                          }
                        }}
                      />
                      <Button type="button" variant="outline" onClick={addKeyword}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(form.watch('criteria.keywords') || []).map((keyword) => (
                        <Badge key={keyword} variant="secondary" className="gap-1">
                          {keyword}
                          <X
                            className="h-3 w-3 cursor-pointer"
                            onClick={() => removeKeyword(keyword)}
                          />
                        </Badge>
                      ))}
                    </div>
                    <FormDescription>
                      Tasks containing these keywords will be matched
                    </FormDescription>
                  </div>

                  {/* Exclude Keywords */}
                  <div className="space-y-2">
                    <FormLabel>Exclude Keywords</FormLabel>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Add keyword to exclude..."
                        value={excludeKeywordInput}
                        onChange={(e) => setExcludeKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addExcludeKeyword();
                          }
                        }}
                      />
                      <Button type="button" variant="outline" onClick={addExcludeKeyword}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(form.watch('criteria.excludeKeywords') || []).map((keyword) => (
                        <Badge key={keyword} variant="destructive" className="gap-1">
                          {keyword}
                          <X
                            className="h-3 w-3 cursor-pointer"
                            onClick={() => removeExcludeKeyword(keyword)}
                          />
                        </Badge>
                      ))}
                    </div>
                    <FormDescription>
                      Tasks containing these keywords will be skipped
                    </FormDescription>
                  </div>

                  {/* Categories */}
                  <FormField
                    control={form.control}
                    name="criteria.categories"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categories</FormLabel>
                        <FormControl>
                          <Select
                            onValueChange={(value) => {
                              const current = field.value || [];
                              if (!current.includes(value)) {
                                field.onChange([...current, value]);
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select category..." />
                            </SelectTrigger>
                            <SelectContent>
                              {categoryOptions.map((category) => (
                                <SelectItem key={category} value={category}>
                                  {category}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {(field.value || []).map((category: string) => (
                            <Badge key={category} variant="secondary" className="gap-1">
                              {category}
                              <X
                                className="h-3 w-3 cursor-pointer"
                                onClick={() =>
                                  field.onChange(
                                    (field.value || []).filter((c: string) => c !== category)
                                  )
                                }
                              />
                            </Badge>
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Require Escrow */}
                  <FormField
                    control={form.control}
                    name="criteria.requireEscrow"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Require Escrow</FormLabel>
                          <FormDescription>
                            Only bid on tasks with escrow deposited
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Submit */}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/agents')}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || !connectedWallet}
                  className="flex-1"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Bot className="mr-2 h-4 w-4" />
                      Create Agent
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </main>
    </div>
  );
}
