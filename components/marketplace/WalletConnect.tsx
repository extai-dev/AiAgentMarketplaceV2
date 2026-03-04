'use client';

import { useAccount, useConnect, useDisconnect, useBalance, useSwitchChain } from 'wagmi';
import { polygonAmoy } from 'wagmi/chains';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/store/useStore';
import { 
  Wallet, 
  ChevronDown, 
  Copy, 
  LogOut, 
  Check, 
  ExternalLink,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { formatAddress, formatBalance } from '@/lib/utils';
import { getAddresses, ERC20_ABI } from '@/lib/contracts/addresses';
import { useReadContract } from 'wagmi';

export function WalletConnect() {
  const { address, isConnected, chain } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const { data: balance } = useBalance({ address });
  const { user, setUser, setTasks } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const addresses = getAddresses(chain?.id);
  const isCorrectNetwork = chain?.id === 80002; // Polygon Amoy
  
  // Read token balance
  const { data: tokenBalance } = useReadContract({
    address: addresses?.token as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!addresses?.token && !!address,
    },
  });

  // Fetch/create user on wallet connect
  useEffect(() => {
    async function syncUser() {
      if (address && !user) {
        try {
          const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: address }),
          });
          const data = await response.json();
          if (data.success) {
            setUser(data.data);
          }
        } catch (error) {
          console.error('Failed to sync user:', error);
        }
      }
    }
    syncUser();
  }, [address, user, setUser]);

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setUser(null);
    setTasks([]);
  };

  const handleSwitchNetwork = () => {
    switchChain({ chainId: polygonAmoy.id });
  };

  const handleViewOnExplorer = () => {
    if (address) {
      const explorerUrl = chain?.id === 80002 
        ? `https://amoy.polygonscan.com/address/${address}`
        : chain?.id === 137
        ? `https://polygonscan.com/address/${address}`
        : `https://etherscan.io/address/${address}`;
      window.open(explorerUrl, '_blank');
    }
  };

  if (!isConnected) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button className="gap-2">
            <Wallet className="h-4 w-4" />
            Connect Wallet
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Your Wallet</DialogTitle>
            <DialogDescription>
              Connect your wallet to participate in the AI Task Marketplace
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            {connectors.map((connector) => (
              <Button
                key={connector.uid}
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={() => {
                  connect({ connector });
                  setIsOpen(false);
                }}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {connector.name}
              </Button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground text-center">
            By connecting, you agree to the Terms of Service
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Wallet className="h-4 w-4" />
          <span className="hidden sm:inline-block">
            {formatAddress(address!)}
          </span>
          <Badge 
            variant={isCorrectNetwork ? 'default' : 'destructive'} 
            className="ml-1 hidden sm:flex"
          >
            {chain?.name || 'Unknown'}
          </Badge>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Address</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={copyAddress}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
            <code className="text-xs bg-muted p-1 rounded">
              {formatAddress(address!)}
            </code>
          </div>
        </DropdownMenuLabel>
        
        <DropdownMenuSeparator />
        
        {/* Network Warning */}
        {!isCorrectNetwork && (
          <>
            <DropdownMenuLabel className="text-xs text-destructive font-normal flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Wrong Network
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleSwitchNetwork}>
              <Loader2 className={`mr-2 h-4 w-4 ${isSwitchingChain ? 'animate-spin' : ''}`} />
              Switch to Polygon Amoy
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        
        {/* Balances */}
        <DropdownMenuItem className="flex justify-between" disabled>
          <span className="text-sm">POL Balance</span>
          <span className="text-sm font-medium">
            {balance ? formatBalance(balance.value, 18, 4) : '0'} POL
          </span>
        </DropdownMenuItem>
        {tokenBalance !== undefined && (
          <DropdownMenuItem className="flex justify-between" disabled>
            <span className="text-sm">TT Balance</span>
            <span className="text-sm font-medium">
              {formatBalance(tokenBalance as bigint, 18, 2)} TT
            </span>
          </DropdownMenuItem>
        )}
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={handleViewOnExplorer}>
          <ExternalLink className="mr-2 h-4 w-4" />
          View on Explorer
        </DropdownMenuItem>
        <DropdownMenuItem 
          className="text-red-500 focus:text-red-500 cursor-pointer"
          onClick={handleDisconnect}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
