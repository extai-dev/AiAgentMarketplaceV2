import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * GET /api/admin/deploy
 * Get the SimpleEscrow contract bytecode and ABI for deployment
 */
export async function GET(request: NextRequest) {
  try {
    // Read the compiled contract artifact
    const artifactPath = join(process.cwd(), 'src/lib/contracts/SimpleEscrow.json');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));

    const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS_POLYGON_AMOY || '0xF9f52599939C51168c72962ce7B6Dcf59CD22B10';

    return NextResponse.json({
      success: true,
      data: {
        bytecode: artifact.bytecode,
        abi: artifact.abi,
        tokenAddress
      }
    });
  } catch (error) {
    console.error('Error reading contract artifact:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read contract artifact' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/deploy
 * Save the deployed contract address to environment
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contractAddress, txHash } = body;

    if (!contractAddress) {
      return NextResponse.json(
        { success: false, error: 'Contract address required' },
        { status: 400 }
      );
    }

    // Return instructions for updating the environment
    return NextResponse.json({
      success: true,
      message: 'Contract deployed successfully! Please update your .env file with:',
      envLine: `NEXT_PUBLIC_SIMPLE_ESCROW_ADDRESS=${contractAddress}`,
      contractAddress,
      txHash,
      instructions: [
        '1. Add the line above to your .env file',
        '2. Restart the development server',
        '3. The new SimpleEscrow address will be used automatically'
      ]
    });
  } catch (error) {
    console.error('Error saving deployment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save deployment' },
      { status: 500 }
    );
  }
}
