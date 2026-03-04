'use client';

import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, type Address } from 'viem';
import { TASK_ESCROW_ABI } from '@/lib/contracts/TaskEscrow';
import { getAddresses, ERC20_ABI } from '@/lib/contracts/addresses';
import { useState, useCallback } from 'react';

// Check if address is valid (not zero address)
export const isValidAddress = (addr: string | undefined): boolean => {
  return !!addr && addr !== '0x0000000000000000000000000000000000000000';
};

// Task status enum matching the contract
export enum TaskStatus {
  Open = 0,
  InProgress = 1,
  Completed = 2,
  Disputed = 3,
  Cancelled = 4,
  Finalized = 5,
}

export enum BidStatus {
  Pending = 0,
  Accepted = 1,
  Rejected = 2,
  Withdrawn = 3,
}

// Task type from contract (Gas Optimized - resultHash removed from struct)
export interface Task {
  id: bigint;
  creator: Address;
  assignedAgent: Address;
  reward: bigint;
  deadline: bigint;  // uint40 in contract, but viem handles conversion
  status: TaskStatus;
  title: string;
  description: string;
  // resultHash removed from struct - now emitted in TaskResultSubmitted event
  createdAt: bigint;  // uint40 in contract
  completedAt: bigint;  // uint40 in contract
}

export interface Bid {
  id: bigint;
  taskId: bigint;
  agent: Address;
  amount: bigint;
  status: BidStatus;
  createdAt: bigint;  // uint40 in contract, viem handles conversion
  message: string;
}

export function useTaskContract() {
  const { chainId, address } = useAccount();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const [lastTxHash, setLastTxHash] = useState<Address | undefined>(undefined);

  const addresses = getAddresses(chainId);
  const escrowAddress = addresses?.escrow as Address | undefined;
  const tokenAddress = addresses?.token as Address | undefined;

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: lastTxHash,
  });

  // Read: Task counter
  const { data: taskCounter } = useReadContract({
    address: escrowAddress,
    abi: TASK_ESCROW_ABI,
    functionName: 'taskCounter',
    query: {
      enabled: !!escrowAddress,
    },
  });

  // Read: Token balance
  const { data: tokenBalance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address!],
    query: {
      enabled: !!tokenAddress && !!address,
    },
  });

  // Read: Token allowance
  const { data: tokenAllowance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address!, escrowAddress!],
    query: {
      enabled: !!tokenAddress && !!escrowAddress && !!address,
    },
  });

  // Write: Create task
  const createTask = useCallback(async (
    title: string,
    description: string,
    reward: string,
    deadlineSeconds: number
  ) => {
    if (!escrowAddress) throw new Error('Contract not deployed on this network');
    
    await writeContract({
      address: escrowAddress,
      abi: TASK_ESCROW_ABI,
      functionName: 'createTask',
      args: [title, description, parseEther(reward), Number(deadlineSeconds)],
    });
    
    // Get the transaction hash from the result
    const txHash = hash;
    if (txHash) {
      setLastTxHash(txHash);
    }
    return txHash;
  }, [escrowAddress, writeContract, hash]);

  // Write: Approve tokens
  const approveTokens = useCallback(async (amount: string) => {
    if (!tokenAddress || !escrowAddress) {
      throw new Error('Contracts not deployed on this network');
    }

    await writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [escrowAddress, parseEther(amount)],
    });
    
    // Get the transaction hash from the result
    const txHash = hash;
    if (txHash) {
      setLastTxHash(txHash);
    }
    return txHash;
  }, [tokenAddress, escrowAddress, writeContract, hash]);

  // Write: Deposit escrow
  const depositEscrow = useCallback(async (taskId: bigint, amount: string) => {
    if (!escrowAddress) {
      throw new Error('Contract not deployed on this network');
    }

    await writeContract({
      address: escrowAddress,
      abi: TASK_ESCROW_ABI,
      functionName: 'depositEscrow',
      args: [taskId, parseEther(amount)],
    });
    
    // Get the transaction hash from the result
    const txHash = hash;
    if (txHash) {
      setLastTxHash(txHash);
    }
    return txHash;
  }, [escrowAddress, writeContract, hash]);

  // Write: Submit bid
  const submitBid = useCallback(async (taskId: bigint, amount: string, message: string) => {
    if (!escrowAddress) throw new Error('Contract not deployed on this network');

    await writeContract({
      address: escrowAddress,
      abi: TASK_ESCROW_ABI,
      functionName: 'submitBid',
      args: [taskId, parseEther(amount), message],
    });
    
    // Get the transaction hash from the result
    const txHash = hash;
    if (txHash) {
      setLastTxHash(txHash);
    }
    return txHash;
  }, [escrowAddress, writeContract, hash]);

  // Write: Accept bid
  const acceptBid = useCallback(async (bidId: bigint) => {
    if (!escrowAddress) throw new Error('Contract not deployed on this network');

    await writeContract({
      address: escrowAddress,
      abi: TASK_ESCROW_ABI,
      functionName: 'acceptBid',
      args: [bidId],
    });
    
    // Get the transaction hash from the result
    const txHash = hash;
    if (txHash) {
      setLastTxHash(txHash);
    }
    return txHash;
  }, [escrowAddress, writeContract, hash]);

  // Write: Complete task
  const completeTask = useCallback(async (taskId: bigint, resultHash: string) => {
    if (!escrowAddress) throw new Error('Contract not deployed on this network');

    await writeContract({
      address: escrowAddress,
      abi: TASK_ESCROW_ABI,
      functionName: 'completeTask',
      args: [taskId, resultHash],
    });
    
    // Get the transaction hash from the result
    const txHash = hash;
    if (txHash) {
      setLastTxHash(txHash);
    }
    return txHash;
  }, [escrowAddress, writeContract, hash]);

  // Write: Approve and release payment
  const approveAndRelease = useCallback(async (taskId: bigint) => {
    if (!escrowAddress) throw new Error('Contract not deployed on this network');

    await writeContract({
      address: escrowAddress,
      abi: TASK_ESCROW_ABI,
      functionName: 'approveAndRelease',
      args: [taskId],
    });
    
    // Get the transaction hash from the result
    const txHash = hash;
    if (txHash) {
      setLastTxHash(txHash);
    }
    return txHash;
  }, [escrowAddress, writeContract, hash]);

  // Write: Cancel task
  const cancelTask = useCallback(async (taskId: bigint) => {
    if (!escrowAddress) throw new Error('Contract not deployed on this network');

    await writeContract({
      address: escrowAddress,
      abi: TASK_ESCROW_ABI,
      functionName: 'cancelTask',
      args: [taskId],
    });
    
    // Get the transaction hash from the result
    const txHash = hash;
    if (txHash) {
      setLastTxHash(txHash);
    }
    return txHash;
  }, [escrowAddress, writeContract, hash]);

  // Write: Raise dispute
  const raiseDispute = useCallback(async (taskId: bigint) => {
    if (!escrowAddress) throw new Error('Contract not deployed on this network');

    await writeContract({
      address: escrowAddress,
      abi: TASK_ESCROW_ABI,
      functionName: 'raiseDispute',
      args: [taskId],
    });
    
    // Get the transaction hash from the result
    const txHash = hash;
    if (txHash) {
      setLastTxHash(txHash);
    }
    return txHash;
  }, [escrowAddress, writeContract, hash]);

  // Reset transaction state
  const resetTx = useCallback(() => {
    setLastTxHash(undefined);
    reset();
  }, [reset]);

  return {
    // Contract addresses
    escrowAddress,
    tokenAddress,
    isConnected: !!address && !!escrowAddress,
    
    // Read data
    taskCounter,
    tokenBalance,
    tokenAllowance,
    
    // Write functions
    createTask,
    approveTokens,
    depositEscrow,
    submitBid,
    acceptBid,
    completeTask,
    approveAndRelease,
    cancelTask,
    raiseDispute,
    
    // Transaction state
    txHash: lastTxHash,
    isPending,
    isConfirming,
    isConfirmed,
    error,
    resetTx,
  };
}
