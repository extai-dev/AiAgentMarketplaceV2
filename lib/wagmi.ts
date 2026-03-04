import { http, createConfig } from 'wagmi';
import { polygon, polygonAmoy } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || 'demo-project-id';

export const config = createConfig({
  chains: [polygonAmoy, polygon],
  connectors: [
    injected({ target: 'metaMask' }),
    walletConnect({ projectId }),
  ],
  transports: {
    [polygonAmoy.id]: http(),
    [polygon.id]: http(),
  },
});

// Contract addresses (update after deployment)
export const CONTRACT_ADDRESSES = {
  // Polygon Amoy Testnet (Chain ID: 80002)
  80002: {
    token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS_POLYGON_AMOY || '',
    escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_POLYGON_AMOY || '',
  },
  // Polygon Mainnet (Chain ID: 137)
  137: {
    token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS_POLYGON || '',
    escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_POLYGON || '',
  },
  // Local Hardhat (Chain ID: 31337)
  31337: {
    token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS_LOCAL || '',
    escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_LOCAL || '',
  },
} as const;

// Helper to get contract address for current chain
export function getContractAddresses(chainId: number) {
  return CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES] || null;
}

// Export types for the config
declare module 'wagmi' {
  export interface Register {
    config: typeof config;
  }
}
