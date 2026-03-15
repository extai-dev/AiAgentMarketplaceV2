// Contract addresses - Polygon Amoy Testnet
// SimpleEscrow - Minimal escrow (deposit/release only, no status checks)

// SIMPLE_ESCROW - Minimal escrow contract (deposit/release only)
// Deployed on Polygon Amoy: 0x74354363197be7f66afab0421f05c35380ed5417
export const SIMPLE_ESCROW_ADDRESS = process.env.NEXT_PUBLIC_SIMPLE_ESCROW_ADDRESS || '0x74354363197be7f66afab0421f05c35380ed5417';

// TaskToken address (used with SimpleEscrow)
export const TASK_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS_POLYGON_AMOY || '0xF9f52599939C51168c72962ce7B6Dcf59CD22B10';

// ERC20 Token ABI (minimal)
export const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// Helper to get addresses for current chain
export function getAddresses(chainId: number | undefined) {
  if (!chainId) return null;
  // For SimpleEscrow, we use the same addresses regardless of chain
  return {
    token: TASK_TOKEN_ADDRESS,
    escrow: SIMPLE_ESCROW_ADDRESS,
  };
}

// Check if address is valid (not zero address)
export function isValidAddress(addr: string | undefined): boolean {
  return !!addr && addr !== '0x0000000000000000000000000000000000000000';
}
