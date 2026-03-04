// Contract addresses - Polygon Amoy Testnet
// SimpleEscrow - Minimal escrow (deposit/release only, no status checks)

// OLD contract addresses (for backwards compatibility with existing tasks)
export const OLD_ADDRESSES = {
  token: '0x7b10328Cb3E83B99827c84970413c5e007D7C58F',
  escrow: '0xe8337FAA73C3FA6037FDF3D4962bb737b677Aaf6',
};

// NEW optimized contract addresses (TaskEscrow - complex lifecycle)
export const NEW_ADDRESSES = {
  token: '0xF9f52599939C51168c72962ce7B6Dcf59CD22B10',
  escrow: '0x6D6263c3742A855E853C9520517ABB1D168CF0F9',
};

// SIMPLE_ESCROW - Minimal escrow contract (deposit/release only)
// Deployed on Polygon Amoy: 0x74354363197be7f66afab0421f05c35380ed5417
export const SIMPLE_ESCROW_ADDRESS = process.env.NEXT_PUBLIC_SIMPLE_ESCROW_ADDRESS || '0x74354363197be7f66afab0421f05c35380ed5417';

// TaskToken address (used with SimpleEscrow)
export const TASK_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS_POLYGON_AMOY || NEW_ADDRESSES.token;

export const ADDRESSES: Record<number, { token: string; escrow: string }> = {
  // Polygon Amoy Testnet (Chain ID: 80002)
  80002: {
    token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS_POLYGON_AMOY || NEW_ADDRESSES.token,
    escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_POLYGON_AMOY || NEW_ADDRESSES.escrow,
  },
  // Polygon Mainnet (Chain ID: 137) - Not deployed yet
  137: {
    token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS_POLYGON || '0x0000000000000000000000000000000000000000',
    escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_POLYGON || '0x0000000000000000000000000000000000000000',
  },
  // Local Hardhat (Chain ID: 31337)
  31337: {
    token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS_LOCAL || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_LOCAL || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  },
};

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
  return ADDRESSES[chainId] || null;
}

// Check if address is valid (not zero address)
export function isValidAddress(addr: string | undefined): boolean {
  return !!addr && addr !== '0x0000000000000000000000000000000000000000';
}
