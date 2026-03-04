'use client';

import { useState, useEffect } from 'react';
import { useAccount, useDeployContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { polygonAmoy } from 'wagmi/chains';
import { type Address, parseAbi } from 'viem';
import { Navbar } from '@/components/marketplace/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { TASK_TOKEN_ADDRESS } from '@/lib/contracts/addresses';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Shield,
  Copy,
  Check
} from 'lucide-react';

export default function DeployPage() {
  const { address, isConnected, chain } = useAccount();
  const { toast } = useToast();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  const [bytecode, setBytecode] = useState<string>('');
  const [abi, setAbi] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const isCorrectNetwork = chain?.id === 80002;
  const tokenAddress = TASK_TOKEN_ADDRESS as Address;

  // Deploy contract hook
  const { deployContract, data: deployHash, isPending: isDeploying } = useDeployContract();

  // Wait for deployment confirmation
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({
    hash: deployHash,
  });

  // Fetch contract artifact on mount
  useEffect(() => {
    const fetchArtifact = async () => {
      try {
        const response = await fetch('/api/admin/deploy');
        const result = await response.json();
        if (result.success) {
          setBytecode(result.data.bytecode);
          setAbi(result.data.abi);
        }
      } catch (error) {
        console.error('Error fetching artifact:', error);
        toast({
          title: 'Error',
          description: 'Failed to load contract artifact',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchArtifact();
  }, [toast]);

  // Handle deployment confirmation
  useEffect(() => {
    if (isConfirmed && receipt && receipt.contractAddress) {
      const contractAddress = receipt.contractAddress;
      toast({
        title: 'Contract Deployed!',
        description: `SimpleEscrow deployed to ${contractAddress}`,
      });

      // Save deployment info
      fetch('/api/admin/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress,
          txHash: deployHash,
        }),
      });
    }
  }, [isConfirmed, receipt, deployHash, toast]);

  const handleSwitchNetwork = async () => {
    try {
      await switchChainAsync({ chainId: polygonAmoy.id });
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  };

  const handleDeploy = async () => {
    if (!isConnected || !isCorrectNetwork || !bytecode || !abi) return;

    try {
      await deployContract({
        abi,
        bytecode: bytecode as `0x${string}`,
        args: [tokenAddress],
      });
    } catch (error: any) {
      console.error('Deployment error:', error);
      toast({
        title: 'Deployment Failed',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const copyEnvLine = (contractAddress: string) => {
    const envLine = `NEXT_PUBLIC_SIMPLE_ESCROW_ADDRESS=${contractAddress}`;
    navigator.clipboard.writeText(envLine);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: 'Copied!',
      description: 'Environment variable copied to clipboard',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Admin: Deploy Contracts</h1>
              <p className="text-muted-foreground">Deploy the SimpleEscrow contract to Polygon Amoy</p>
            </div>
          </div>

          {/* Connection Status */}
          {!isConnected && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Not Connected</AlertTitle>
              <AlertDescription>
                Please connect your wallet to deploy contracts.
              </AlertDescription>
            </Alert>
          )}

          {/* Network Warning */}
          {isConnected && !isCorrectNetwork && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Wrong Network</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>Switch to Polygon Amoy to deploy contracts.</span>
                <Button size="sm" onClick={handleSwitchNetwork} disabled={isSwitchingChain}>
                  {isSwitchingChain ? 'Switching...' : 'Switch Network'}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Deployment Card */}
          <Card>
            <CardHeader>
              <CardTitle>SimpleEscrow Contract</CardTitle>
              <CardDescription>
                Minimal escrow contract for the AI Agent Task Marketplace.
                Handles deposit and release of funds without complex state management.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Contract Info */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Network</span>
                  <span className="font-medium">Polygon Amoy (Chain ID: 80002)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Token Address</span>
                  <a
                    href={`https://amoy.polygonscan.com/address/${tokenAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-600 hover:underline flex items-center gap-1"
                  >
                    {tokenAddress.slice(0, 8)}...{tokenAddress.slice(-6)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deployer</span>
                  <span className="font-medium font-mono">
                    {address ? `${address.slice(0, 8)}...${address.slice(-6)}` : 'Not connected'}
                  </span>
                </div>
              </div>

              {/* Deploy Button */}
              <Button
                className="w-full"
                size="lg"
                onClick={handleDeploy}
                disabled={!isConnected || !isCorrectNetwork || isDeploying || isConfirming || isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading Contract...
                  </>
                ) : isDeploying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Confirm in Wallet...
                  </>
                ) : isConfirming ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deploying Contract...
                  </>
                ) : (
                  <>
                    <Shield className="h-4 w-4 mr-2" />
                    Deploy SimpleEscrow
                  </>
                )}
              </Button>

              {/* Transaction Hash */}
              {deployHash && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Transaction Hash:</div>
                  <a
                    href={`https://amoy.polygonscan.com/tx/${deployHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                  >
                    {deployHash}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {/* Deployment Success */}
              {isConfirmed && receipt?.contractAddress && (() => {
                const contractAddress = receipt.contractAddress as Address;
                return (
                <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-900">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertTitle className="text-green-800 dark:text-green-200">
                    Contract Deployed Successfully!
                  </AlertTitle>
                  <AlertDescription className="space-y-2">
                    <div>
                      <strong>Contract Address:</strong>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs bg-muted p-1 rounded flex-1 overflow-hidden">
                          {contractAddress}
                        </code>
                        <a
                          href={`https://amoy.polygonscan.com/address/${contractAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                    <div className="mt-4 p-3 bg-muted rounded">
                      <p className="text-sm font-medium mb-2">Add to your .env file:</p>
                      <div className="flex items-center gap-2">
                        <code className="text-xs flex-1">
                          NEXT_PUBLIC_SIMPLE_ESCROW_ADDRESS={contractAddress}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyEnvLine(contractAddress)}
                        >
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      After updating .env, restart your development server for the changes to take effect.
                    </p>
                  </AlertDescription>
                </Alert>
                );
              })()}
            </CardContent>
          </Card>

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">How it works</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Connect your wallet with MATIC on Polygon Amoy</li>
                <li>Click "Deploy SimpleEscrow" button</li>
                <li>Confirm the transaction in your wallet</li>
                <li>Copy the environment variable and add to .env</li>
                <li>Restart the development server</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
