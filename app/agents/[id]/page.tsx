'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Agent, AgentStatusType } from '@/store/useStore';
import {
  ArrowLeft,
  Bot,
  Settings,
  Activity,
  Clock,
  AlertCircle,
  CheckCircle2,
  Pause,
  Play,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Coins,
  MessageSquare,
  Loader2,
  Wifi,
  WifiOff,
  Key,
  Trash2
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

const agentEditSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name too long'),
  description: z.string().max(500, 'Description too long').optional(),
  execUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  status: z.enum(['ACTIVE', 'PAUSED']),
  criteria: z.object({
    minReward: z.number().min(0).optional(),
    maxReward: z.number().min(0).optional(),
    keywords: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    requireEscrow: z.boolean().optional(),
    excludeKeywords: z.array(z.string()).optional(),
  }),
});

type AgentEditForm = z.infer<typeof agentEditSchema>;

const statusConfig: Record<AgentStatusType, { label: string; color: string; bgColor: string }> = {
  ACTIVE: { label: 'Active', color: 'text-green-600', bgColor: 'bg-green-100 dark:bg-green-900' },
  PAUSED: { label: 'Paused', color: 'text-yellow-600', bgColor: 'bg-yellow-100 dark:bg-yellow-900' },
  OFFLINE: { label: 'Offline', color: 'text-gray-600', bgColor: 'bg-gray-100 dark:bg-gray-900' },
  ERROR: { label: 'Error', color: 'text-red-600', bgColor: 'bg-red-100 dark:bg-red-900' },
};

export default function AgentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const agentId = params.id as string;
  const { address: connectedWallet } = useAccount();
  const { toast } = useToast();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegeneratingToken, setIsRegeneratingToken] = useState(false);
  const [newApiToken, setNewApiToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const [excludeKeywordInput, setExcludeKeywordInput] = useState('');

  const form = useForm<AgentEditForm>({
    resolver: zodResolver(agentEditSchema),
    defaultValues: {
      name: '',
      description: '',
      execUrl: '',
      status: 'ACTIVE',
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

  useEffect(() => {
    const fetchAgent = async () => {
      try {
        const response = await fetch(`/api/agents/${agentId}`);
        const data = await response.json();

        if (data.success) {
          setAgent(data.data);
          form.reset({
            name: data.data.name,
            description: data.data.description || '',
            execUrl: data.data.execUrl || '',
            status: data.data.status,
            criteria: data.data.criteria || {
              minReward: 0,
              maxReward: 1000,
              keywords: [],
              categories: [],
              requireEscrow: false,
              excludeKeywords: [],
            },
          });
        } else {
          throw new Error(data.error || 'Agent not found');
        }
      } catch (error: any) {
        console.error('Failed to fetch agent:', error);
        toast({
          title: 'Error',
          description: error.message || 'Failed to load agent',
          variant: 'destructive',
        });
        router.push('/agents');
      } finally {
        setIsLoading(false);
      }
    };

    if (agentId) {
      fetchAgent();
    }
  }, [agentId, router, toast, form]);

  const handleSave = async (data: AgentEditForm) => {
    if (!connectedWallet) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect your wallet',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          ownerWalletAddress: connectedWallet,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setAgent({ ...agent!, ...result.data });
        toast({
          title: 'Saved',
          description: 'Agent configuration updated',
        });
      } else {
        throw new Error(result.error || 'Failed to update agent');
      }
    } catch (error: any) {
      console.error('Failed to save agent:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save changes',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegenerateToken = async () => {
    if (!confirm('This will invalidate the current API token. Continue?')) {
      return;
    }

    setIsRegeneratingToken(true);
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerWalletAddress: connectedWallet,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setNewApiToken(result.data.apiToken);
        toast({
          title: 'Token Regenerated',
          description: 'Save the new token securely',
        });
      } else {
        throw new Error(result.error || 'Failed to regenerate token');
      }
    } catch (error: any) {
      console.error('Failed to regenerate token:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to regenerate token',
        variant: 'destructive',
      });
    } finally {
      setIsRegeneratingToken(false);
    }
  };

  const handleDeactivate = async () => {
    if (!confirm('This will deactivate the agent. Continue?')) {
      return;
    }

    try {
      const response = await fetch(
        `/api/agents/${agentId}?ownerWalletAddress=${connectedWallet}`,
        { method: 'DELETE' }
      );

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Agent Deactivated',
          description: 'The agent has been deactivated',
        });
        router.push('/agents');
      } else {
        throw new Error(result.error || 'Failed to deactivate agent');
      }
    } catch (error: any) {
      console.error('Failed to deactivate agent:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to deactivate agent',
        variant: 'destructive',
      });
    }
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <ClientNavbar />
        <main className="container px-4 py-8">
          <Skeleton className="h-8 w-32 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="h-64 lg:col-span-2" />
            <Skeleton className="h-64" />
          </div>
        </main>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-background">
        <ClientNavbar />
        <main className="container px-4 py-8">
          <div className="text-center py-12">
            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Agent Not Found</h2>
            <Button onClick={() => router.push('/agents')}>Back to Agents</Button>
          </div>
        </main>
      </div>
    );
  }

  const statusConf = statusConfig[agent.status];

  return (
    <div className="min-h-screen bg-background">
      <ClientNavbar />
      <main className="container px-4 py-8">
        <Button variant="ghost" className="mb-6" onClick={() => router.push('/agents')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Agents
        </Button>

        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{agent.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <Badge className={`${statusConf.bgColor} ${statusConf.color}`}>
                  {statusConf.label}
                </Badge>
                {agent.isOnline ? (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <Wifi className="h-3 w-3" /> Online
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm text-gray-400">
                    <WifiOff className="h-3 w-3" /> Offline
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                form.setValue('status', form.getValues('status') === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');
                form.handleSubmit(handleSave)();
              }}
            >
              {form.watch('status') === 'ACTIVE' ? (
                <>
                  <Pause className="h-4 w-4 mr-1" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" /> Resume
                </>
              )}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="settings" className="space-y-6">
          <TabsList>
            <TabsTrigger value="settings">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="logs">
              <Activity className="h-4 w-4 mr-2" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="stats">
              <Coins className="h-4 w-4 mr-2" />
              Statistics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleSave)} className="space-y-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Agent Configuration</CardTitle>
                        <CardDescription>Update your agent&apos;s settings</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Name</FormLabel>
                              <FormControl>
                                <Input {...field} />
                              </FormControl>
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
                                <Textarea className="min-h-[80px]" {...field} />
                              </FormControl>
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
                                <Input type="url" placeholder="https://" {...field} />
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

                    <Card>
                      <CardHeader>
                        <CardTitle>Matching Criteria</CardTitle>
                        <CardDescription>Configure which tasks your agent should consider</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="criteria.minReward"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Min Reward</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="criteria.maxReward"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Max Reward</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={form.control}
                          name="criteria.requireEscrow"
                          render={({ field }) => (
                            <FormItem className="flex items-center justify-between rounded-lg border p-4">
                              <div>
                                <FormLabel>Require Escrow</FormLabel>
                                <FormDescription>
                                  Only match tasks with escrow deposited
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <div className="flex justify-end gap-3 pt-4">
                          <Button type="submit" disabled={isSaving}>
                            {isSaving ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              'Save Changes'
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </form>
                </Form>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Agent Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Agent Info</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">ID:</span>
                      <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">{agent.id}</code>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Wallet:</span>
                      <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">
                        {agent.walletAddress.slice(0, 8)}...{agent.walletAddress.slice(-6)}
                      </code>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Created:</span>
                      <span className="ml-2">
                        {formatDistanceToNow(new Date(agent.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    {agent.lastSeen && (
                      <div>
                        <span className="text-muted-foreground">Last Seen:</span>
                        <span className="ml-2">
                          {formatDistanceToNow(new Date(agent.lastSeen), { addSuffix: true })}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* API Token */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Key className="h-4 w-4" />
                      API Token
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {newApiToken ? (
                      <div className="space-y-2">
                        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded p-2 text-xs text-amber-700 dark:text-amber-300">
                          New token generated! Save it securely.
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-xs bg-muted p-2 rounded break-all">
                            {newApiToken}
                          </code>
                          <Button variant="outline" size="icon" onClick={() => copyToken(newApiToken)}>
                            {copiedToken ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Token is hidden for security. Regenerate to get a new token.
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={handleRegenerateToken}
                      disabled={isRegeneratingToken}
                    >
                      {isRegeneratingToken ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Regenerate Token
                    </Button>
                  </CardContent>
                </Card>

                {/* Danger Zone */}
                <Card className="border-destructive/50">
                  <CardHeader>
                    <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={handleDeactivate}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Deactivate Agent
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="logs">
            <Card>
              <CardHeader>
                <CardTitle>Activity Log</CardTitle>
                <CardDescription>Recent activity and events for this agent</CardDescription>
              </CardHeader>
              <CardContent>
                {agent.logs && agent.logs.length > 0 ? (
                  <div className="space-y-2">
                    {agent.logs.map((log: any) => (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                      >
                        <div
                          className={`h-2 w-2 rounded-full mt-2 ${
                            log.level === 'ERROR'
                              ? 'bg-red-500'
                              : log.level === 'WARN'
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                          }`}
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{log.action}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{log.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No logs available yet
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stats">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-2xl">{agent.totalDispatches || 0}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>Total Tasks Received</CardDescription>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-2xl">{agent.totalBids || 0}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>Bids Submitted</CardDescription>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-2xl">{agent.acceptedBids || 0}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>Bids Accepted</CardDescription>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
