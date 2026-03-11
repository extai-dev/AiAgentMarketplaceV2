'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { ClientNavbar } from '@/components/marketplace/ClientNavbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  ArrowLeft, 
  Bot, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Copy, 
  Check, 
  ExternalLink,
  Shield,
  Globe,
  Zap,
  Link2
} from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  walletAddress: string;
  status: string;
  erc8004AgentId: string | null;
  metadataUri: string | null;
  capabilities: string;
  endpoints: string;
  execUrl: string | null;
  createdAt: string;
}

const capabilityOptions = [
  'data-processing',
  'natural-language',
  'code-generation',
  'image-generation',
  'audio-processing',
  'video-processing',
  'web-scraping',
  'api-integration',
  'analytics',
  'automation',
  'translation',
  'summarization',
  'classification',
  'prediction',
  'optimization',
];

export default function RegisterOnChainPage() {
  const router = useRouter();
  const { address: connectedWallet, isConnected } = useAccount();
  const { toast } = useToast();
  
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationResult, setRegistrationResult] = useState<{
    success: boolean;
    erc8004AgentId?: string;
    transactionHash?: string;
    error?: string;
  } | null>(null);
  
  // Metadata form state
  const [metadataName, setMetadataName] = useState('');
  const [metadataDescription, setMetadataDescription] = useState('');
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [serviceEndpoint, setServiceEndpoint] = useState('');
  const [protocol, setProtocol] = useState('https');
  const [copiedId, setCopiedId] = useState(false);

  // Fetch user's agents
  useEffect(() => {
    const fetchAgents = async () => {
      if (!connectedWallet) {
        setIsLoadingAgents(false);
        return;
      }

      try {
        const response = await fetch(`/api/agents?source=local&ownerWalletAddress=${connectedWallet}`);
        const data = await response.json();
        
        if (data.success && data.data) {
          setAgents(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch agents:', error);
      } finally {
        setIsLoadingAgents(false);
      }
    };

    fetchAgents();
  }, [connectedWallet]);

  // Set initial values when agent is selected
  useEffect(() => {
    if (selectedAgent) {
      setMetadataName(selectedAgent.name);
      setMetadataDescription(selectedAgent.description || '');
      
      try {
        const caps = JSON.parse(selectedAgent.capabilities || '[]');
        setSelectedCapabilities(caps);
      } catch {
        setSelectedCapabilities([]);
      }
      
      setServiceEndpoint(selectedAgent.execUrl || '');
    }
  }, [selectedAgent]);

  const toggleCapability = (cap: string) => {
    setSelectedCapabilities(prev => 
      prev.includes(cap) 
        ? prev.filter(c => c !== cap)
        : [...prev, cap]
    );
  };

  const handleRegister = async () => {
    if (!selectedAgent || !connectedWallet) {
      toast({
        title: 'Error',
        description: 'Please select an agent and connect your wallet',
        variant: 'destructive',
      });
      return;
    }

    setIsRegistering(true);
    setRegistrationResult(null);

    try {
      const response = await fetch('/api/agents/register-on-chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgent.id,
          ownerWalletAddress: connectedWallet,
          metadata: {
            name: metadataName,
            description: metadataDescription,
            capabilities: selectedCapabilities,
            endpoints: serviceEndpoint ? [{
              name: 'default',
              endpoint: serviceEndpoint,
              protocol,
            }] : [],
            version: '1.0.0',
          },
        }),
      });

      const result = await response.json();

      if (result.success) {
        setRegistrationResult({
          success: true,
          erc8004AgentId: result.data.erc8004AgentId,
          transactionHash: result.data.transactionHash,
        });
        toast({
          title: 'Registration Successful!',
          description: `Agent registered on ERC-8004 with ID: ${result.data.erc8004AgentId}`,
        });
      } else {
        setRegistrationResult({
          success: false,
          error: result.error || 'Failed to register on chain',
        });
        toast({
          title: 'Registration Failed',
          description: result.error || 'Failed to register on chain',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      setRegistrationResult({
        success: false,
        error: error.message || 'Registration failed',
      });
      toast({
        title: 'Error',
        description: error.message || 'Registration failed',
        variant: 'destructive',
      });
    } finally {
      setIsRegistering(false);
    }
  };

  const copyAgentId = () => {
    if (registrationResult?.erc8004AgentId) {
      navigator.clipboard.writeText(registrationResult.erc8004AgentId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const viewOnExplorer = (agentId: string) => {
    const chainId = agentId.split(':')[1] || '80002';
    const tokenId = agentId.split(':')[2] || '';
    // Use a block explorer based on the chain
    window.open(`https://amoy.polygonscan.com/token/0x0000000000000000000000000000000000000000?a=${tokenId}`, '_blank');
  };

  // Success screen
  if (registrationResult?.success) {
    return (
      <div className="min-h-screen bg-background">
        <ClientNavbar />
        <main className="container px-4 py-8">
          <Card className="max-w-2xl mx-auto">
            <CardHeader className="text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="text-2xl">ERC-8004 Registration Complete!</CardTitle>
              <CardDescription>
                Your agent "{selectedAgent?.name}" is now registered on the blockchain
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-blue-800 dark:text-blue-200">
                      Agent Verified on ERC-8004
                    </h3>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      Your agent is now part of the decentralized agent registry
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">ERC-8004 Agent ID</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-3 bg-muted rounded-lg text-sm font-mono">
                    {registrationResult.erc8004AgentId}
                  </code>
                  <Button variant="outline" size="icon" onClick={copyAgentId}>
                    {copiedId ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {registrationResult.transactionHash && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Transaction Hash</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-3 bg-muted rounded-lg text-sm font-mono break-all">
                      {registrationResult.transactionHash}
                    </code>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={() => window.open(`https://amoy.polygonscan.com/tx/${registrationResult.transactionHash}`, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-muted-foreground">Chain</div>
                  <div className="font-medium">Polygon Amoy (Testnet)</div>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-muted-foreground">Standard</div>
                  <div className="font-medium">ERC-8004</div>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <Button variant="outline" onClick={() => router.push('/agents')} className="flex-1">
                  View All Agents
                </Button>
                <Button onClick={() => router.push(`/agents/${selectedAgent?.id}`)} className="flex-1">
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

        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Shield className="h-8 w-8 text-purple-600" />
              Register Agent on ERC-8004
            </h1>
            <p className="text-muted-foreground mt-2">
              Register your agent on the blockchain using the ChaosChain SDK to make it discoverable in the decentralized agent marketplace
            </p>
          </div>

          {!isConnected && (
            <Card className="mb-6 border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-900">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                  <AlertCircle className="h-5 w-5" />
                  <span>Connect your wallet to register an agent on the blockchain</span>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Agent Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  Select Agent
                </CardTitle>
                <CardDescription>
                  Choose an agent from your account to register
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingAgents ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : agents.length === 0 ? (
                  <div className="text-center py-8">
                    <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-4">No agents found</p>
                    <Button onClick={() => router.push('/agents/new')}>
                      Create New Agent
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {agents.map((agent) => (
                      <div
                        key={agent.id}
                        onClick={() => setSelectedAgent(agent)}
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          selectedAgent?.id === agent.id
                            ? 'border-purple-500 bg-purple-50 dark:bg-purple-950'
                            : 'border-border hover:border-purple-300'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-medium">{agent.name}</h3>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {agent.description || 'No description'}
                            </p>
                          </div>
                          {agent.erc8004AgentId && (
                            <Badge variant="default" className="bg-green-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              On-Chain
                            </Badge>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{agent.walletAddress.slice(0, 6)}...{agent.walletAddress.slice(-4)}</span>
                          <span>•</span>
                          <Badge variant="outline">{agent.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Metadata Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Agent Metadata
                </CardTitle>
                <CardDescription>
                  Configure the metadata that will be stored on-chain
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Agent Name</label>
                  <Input
                    value={metadataName}
                    onChange={(e) => setMetadataName(e.target.value)}
                    placeholder="My AI Agent"
                    disabled={!selectedAgent}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={metadataDescription}
                    onChange={(e) => setMetadataDescription(e.target.value)}
                    placeholder="Describe what your agent does..."
                    disabled={!selectedAgent}
                    rows={3}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Service Endpoint</label>
                  <Input
                    value={serviceEndpoint}
                    onChange={(e) => setServiceEndpoint(e.target.value)}
                    placeholder="https://your-agent.com/api"
                    disabled={!selectedAgent}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The URL where tasks will be dispatched to your agent
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium">Protocol</label>
                  <Select
                    value={protocol}
                    onValueChange={setProtocol}
                    disabled={!selectedAgent}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="https">HTTPS</SelectItem>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="wss">WSS</SelectItem>
                      <SelectItem value="ws">WS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium">Capabilities</label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {capabilityOptions.map((cap) => (
                      <Badge
                        key={cap}
                        variant={selectedCapabilities.includes(cap) ? 'default' : 'outline'}
                        className={`cursor-pointer ${
                          selectedCapabilities.includes(cap) 
                            ? 'bg-purple-600 hover:bg-purple-700' 
                            : ''
                        }`}
                        onClick={() => selectedAgent && toggleCapability(cap)}
                      >
                        {cap}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Select the capabilities your agent provides
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Registration Summary & Action */}
          {selectedAgent && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Registration Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-3">Selected Agent</h4>
                    <div className="bg-muted rounded-lg p-4 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Name:</span>
                        <span className="font-medium">{selectedAgent.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Wallet:</span>
                        <span className="font-mono text-sm">{selectedAgent.walletAddress.slice(0, 10)}...</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status:</span>
                        <Badge>{selectedAgent.status}</Badge>
                      </div>
                      {selectedAgent.erc8004AgentId && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">ERC-8004 ID:</span>
                          <span className="font-mono text-sm">{selectedAgent.erc8004AgentId.slice(0, 15)}...</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-3">On-Chain Registration</h4>
                    <div className="bg-muted rounded-lg p-4 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Standard:</span>
                        <span className="font-medium">ERC-8004</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Network:</span>
                        <span className="font-medium">Polygon Amoy</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Chain ID:</span>
                        <span className="font-mono">80002</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Capabilities:</span>
                        <span className="font-medium">{selectedCapabilities.length}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {selectedAgent.erc8004AgentId && (
                  <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded-lg">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                      <AlertCircle className="h-5 w-5" />
                      <span className="font-medium">Agent Already Registered</span>
                    </div>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      This agent is already registered on ERC-8004. You can update its metadata by registering again.
                    </p>
                  </div>
                )}

                <div className="mt-6 flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => router.push('/agents')}
                    className="flex-1"
                    disabled={isRegistering}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRegister}
                    disabled={isRegistering || !selectedAgent || !isConnected}
                    className="flex-1 bg-purple-600 hover:bg-purple-700"
                  >
                    {isRegistering ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Registering...
                      </>
                    ) : (
                      <>
                        <Link2 className="mr-2 h-4 w-4" />
                        Register on ERC-8004
                      </>
                    )}
                  </Button>
                </div>

                {registrationResult?.error && (
                  <div className="mt-4 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-lg">
                    <div className="flex items-center gap-2 text-red-800 dark:text-red-200">
                      <AlertCircle className="h-5 w-5" />
                      <span className="font-medium">Registration Failed</span>
                    </div>
                    <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                      {registrationResult.error}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
