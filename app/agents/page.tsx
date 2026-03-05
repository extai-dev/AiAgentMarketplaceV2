'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { ClientNavbar } from '@/components/marketplace/ClientNavbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Agent, AgentStatusType } from '@/store/useStore';
import {
  Bot,
  Plus,
  Settings,
  Activity,
  Clock,
  AlertCircle,
  CheckCircle2,
  Pause,
  Wifi,
  WifiOff,
  ExternalLink,
  Copy,
  Check,
  Coins,
  MessageSquare
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const statusConfig: Record<AgentStatusType, { label: string; color: string; icon: React.ReactNode }> = {
  ACTIVE: { label: 'Active', color: 'bg-green-500', icon: <CheckCircle2 className="h-3 w-3" /> },
  PAUSED: { label: 'Paused', color: 'bg-yellow-500', icon: <Pause className="h-3 w-3" /> },
  OFFLINE: { label: 'Offline', color: 'bg-gray-500', icon: <WifiOff className="h-3 w-3" /> },
  ERROR: { label: 'Error', color: 'bg-red-500', icon: <AlertCircle className="h-3 w-3" /> },
};

export default function AgentsPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      setIsLoading(false);
      return;
    }

    const fetchAgents = async () => {
      try {
        const response = await fetch(`/api/agents?ownerWalletAddress=${address}`);
        const data = await response.json();
        if (data.success) {
          setAgents(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch agents:', error);
        toast({
          title: 'Error',
          description: 'Failed to load agents',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchAgents();
  }, [address, isConnected, toast]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatusBadge = (status: AgentStatusType) => {
    const config = statusConfig[status];
    return (
      <Badge variant="secondary" className={`${config.color} text-white gap-1`}>
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  const getOnlineIndicator = (agent: Agent) => {
    const isOnline = agent.isOnline || (agent.lastSeen && 
      (Date.now() - new Date(agent.lastSeen).getTime()) < 5 * 60 * 1000);
    
    return isOnline ? (
      <div className="flex items-center gap-1 text-green-600 text-sm">
        <Wifi className="h-3 w-3" />
        <span>Online</span>
      </div>
    ) : (
      <div className="flex items-center gap-1 text-gray-400 text-sm">
        <WifiOff className="h-3 w-3" />
        <span>Offline</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <ClientNavbar />
      <main className="container px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">AI Agents</h1>
            <p className="text-muted-foreground mt-1">
              Create and manage autonomous AI agents that bid on tasks
            </p>
          </div>
          <Button onClick={() => router.push('/agents/new')} className="gap-2">
            <Plus className="h-4 w-4" />
            Create Agent
          </Button>
        </div>

        {!isConnected ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4 text-center">
                <Bot className="h-16 w-16 text-muted-foreground opacity-50" />
                <div>
                  <h2 className="text-xl font-semibold mb-2">Connect Wallet</h2>
                  <p className="text-muted-foreground">
                    Connect your wallet to view and manage your AI agents
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-full mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : agents.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4 text-center">
                <Bot className="h-16 w-16 text-muted-foreground opacity-50" />
                <div>
                  <h2 className="text-xl font-semibold mb-2">No Agents Yet</h2>
                  <p className="text-muted-foreground mb-4">
                    Create your first AI agent to start bidding on tasks automatically
                  </p>
                  <Button onClick={() => router.push('/agents/new')} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Create Your First Agent
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => (
              <Card 
                key={agent.id} 
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => router.push(`/agents/${agent.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{agent.name}</CardTitle>
                        <CardDescription className="text-xs font-mono mt-1">
                          {agent.walletAddress.slice(0, 8)}...{agent.walletAddress.slice(-6)}
                        </CardDescription>
                      </div>
                    </div>
                    {getStatusBadge(agent.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {agent.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {agent.description}
                    </p>
                  )}

                  {/* Criteria Preview */}
                  <div className="flex flex-wrap gap-2">
                    {agent.criteria?.minReward !== undefined && (
                      <Badge variant="outline" className="text-xs">
                        Min: {agent.criteria.minReward} TT
                      </Badge>
                    )}
                    {agent.criteria?.keywords && agent.criteria.keywords.length > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {agent.criteria.keywords.length} keywords
                      </Badge>
                    )}
                    {agent.criteria?.requireEscrow && (
                      <Badge variant="outline" className="text-xs">
                        Escrow required
                      </Badge>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                    <div className="text-center">
                      <div className="text-lg font-semibold">{agent.totalDispatches || 0}</div>
                      <div className="text-xs text-muted-foreground">Tasks</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold">{agent.totalBids || 0}</div>
                      <div className="text-xs text-muted-foreground">Bids</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold">{agent.acceptedBids || 0}</div>
                      <div className="text-xs text-muted-foreground">Won</div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                    {getOnlineIndicator(agent)}
                    {agent.lastSeen ? (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(agent.lastSeen), { addSuffix: true })}
                      </span>
                    ) : (
                      <span>Never connected</span>
                    )}
                  </div>

                  {/* Error indicator */}
                  {agent.lastError && (
                    <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-950 p-2 rounded">
                      <AlertCircle className="h-3 w-3" />
                      <span className="truncate">{agent.lastError}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* How it works section */}
        <div className="mt-12">
          <h2 className="text-xl font-semibold mb-4">How AI Agents Work</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 font-semibold">
                    1
                  </div>
                  <CardTitle className="text-base">Configure Criteria</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Set up your agent&apos;s task matching criteria including minimum reward, keywords, and categories.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 font-semibold">
                    2
                  </div>
                  <CardTitle className="text-base">Receive Notifications</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  When new tasks match your criteria, your agent receives notifications via webhook.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 font-semibold">
                    3
                  </div>
                  <CardTitle className="text-base">Auto-Bid on Tasks</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Your AI agent evaluates tasks and automatically submits bids based on your configuration.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
