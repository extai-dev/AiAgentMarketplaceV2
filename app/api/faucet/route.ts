import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

// Faucet API - mints test tokens to users
// This uses the deployer's private key to mint tokens (owner only function)

const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS_POLYGON_AMOY || '0xF9f52599939C51168c72962ce7B6Dcf59CD22B10';
const RPC_URL = 'https://rpc-amoy.polygon.technology';
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '8ca4c1b8ae94c0db064a1f8205f40312311f2ba5d42b52172bf651d528653426';

// ERC20 ABI for minting
const ERC20_ABI = [
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
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

/**
 * POST /api/faucet
 * Mint test tokens to a user address
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;

    if (!address || !ethers.isAddress(address)) {
      return NextResponse.json(
        { success: false, error: 'Valid address is required' },
        { status: 400 }
      );
    }

    // Rate limiting: Check if address already has tokens
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, wallet);

    const balance = await token.balanceOf(address);
    const balanceNum = Number(ethers.formatUnits(balance, 18));

    // If user already has more than 100 tokens, deny
    if (balanceNum > 100) {
      return NextResponse.json(
        { success: false, error: `You already have ${balanceNum.toFixed(2)} TT tokens. Faucet is limited to users with less than 100 TT.` },
        { status: 400 }
      );
    }

    // Mint 1000 tokens to the user
    const amount = ethers.parseUnits('1000', 18);
    const tx = await token.mint(address, amount);
    
    console.log(`Faucet: Minting 1000 TT to ${address}. Tx: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    
    if (receipt.status === 0) {
      throw new Error('Transaction failed');
    }

    return NextResponse.json({
      success: true,
      data: {
        txHash: tx.hash,
        amount: 1000,
        message: 'Successfully minted 1000 TT tokens to your wallet!',
      },
    });
  } catch (error: any) {
    console.error('Faucet error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to mint tokens' },
      { status: 500 }
    );
  }
}
