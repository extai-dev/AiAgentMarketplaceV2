'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAccount, useDisconnect, useBalance } from 'wagmi';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { WalletConnect } from './WalletConnect';
import { useStore } from '@/store/useStore';
import { 
  Home, 
  Plus, 
  User, 
  FileText,
  Bot,
  Wallet,
  ChevronDown,
  ExternalLink,
  LogOut,
  Copy,
  Check
} from 'lucide-react';
import { formatAddress, formatBalance } from '@/lib/utils';
import { getAddresses, ERC20_ABI } from '@/lib/contracts/addresses';
import { useReadContract } from 'wagmi';
import { useState } from 'react';

export function Navbar() {
  const router = useRouter();
  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  const { user, setUser, setTasks } = useStore();
  const [copied, setCopied] = useState(false);

  const addresses = getAddresses(chain?.id);
  
  // Type guard to ensure chain is defined
  const chainId = chain?.id;
  const chainName = chain?.name;
  
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
    router.push('/');
  };

  const handleViewOnExplorer = () => {
    if (address) {
      const explorerUrl = chainId === 80002
        ? `https://amoy.polygonscan.com/address/${address}`
        : chainId === 137
        ? `https://polygonscan.com/address/${address}`
        : `https://etherscan.io/address/${address}`;
      window.open(explorerUrl, '_blank');
    }
  };

  const handleMyTasks = () => {
    router.push('/?tab=my-tasks');
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4">
        {/* Logo and main nav */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-sm font-bold">AI</span>
            </div>
            <span className="text-lg font-bold hidden sm:inline-block">
              Task Marketplace
            </span>
          </Link>
          
          <div className="hidden md:flex items-center gap-4">
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <Link href="/">
                <Home className="h-4 w-4" />
                Tasks
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <Link href="/agents">
                <Bot className="h-4 w-4" />
                Agents
              </Link>
            </Button>
            {isConnected && (
              <Button asChild variant="ghost" size="sm" className="gap-2">
                <Link href="/tasks/new">
                  <Plus className="h-4 w-4" />
                  Post Task
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {isConnected ? (
            <>
              {/* Quick actions */}
              <Button asChild size="sm" className="gap-2 hidden sm:flex">
                <Link href="/tasks/new">
                  <Plus className="h-4 w-4" />
                  New Task
                </Link>
              </Button>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {user?.name?.[0]?.toUpperCase() || address?.slice(1, 3).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:inline-block">
                      {user?.name || formatAddress(address!)}
                    </span>
                    <Badge
                      variant={chainId === 80002 ? 'default' : 'secondary'}
                      className="ml-1 hidden sm:flex"
                    >
                      {chainName || (chainId === 80002 ? 'Polygon Amoy' : `Chain ${chainId}`)}
                    </Badge>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{user?.name || 'Anonymous'}</span>
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
                  
                  {/* Balances */}
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    Balances
                  </DropdownMenuLabel>
                  <DropdownMenuItem className="flex justify-between" disabled>
                    <span className="text-sm">POL</span>
                    <span className="text-sm font-medium">
                      {balance ? formatBalance(balance.value, 18, 4) : '0'}
                    </span>
                  </DropdownMenuItem>
                  {tokenBalance !== undefined && addresses?.token && (
                    <DropdownMenuItem className="flex justify-between" disabled>
                      <span className="text-sm">TT (TaskToken)</span>
                      <span className="text-sm font-medium">
                        {formatBalance(tokenBalance as bigint, 18, 2)}
                      </span>
                    </DropdownMenuItem>
                  )}
                  
                  <DropdownMenuSeparator />
                  
                  {/* Navigation */}
                  <DropdownMenuItem onClick={handleMyTasks}>
                    <FileText className="mr-2 h-4 w-4" />
                    My Tasks
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push('/agents')}>
                    <Bot className="mr-2 h-4 w-4" />
                    My Agents
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleViewOnExplorer}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View on Explorer
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator />
                  
                  {/* Sign Out */}
                  <DropdownMenuItem 
                    className="text-red-500 focus:text-red-500 cursor-pointer"
                    onClick={handleDisconnect}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <WalletConnect />
          )}
        </div>
      </div>
    </nav>
  );
}
