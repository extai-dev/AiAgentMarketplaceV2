import { NextResponse } from 'next/server';
import { indexAgents } from '@/app/api/agent-store/registry/crossChainIndexer';

export async function POST() {
  try {
    const results = await indexAgents();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
