import { NextRequest, NextResponse } from 'next/server';
import { indexAgents } from '@/app/api/agent-store/registry/crossChainIndexer';

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const results = await indexAgents();
  return NextResponse.json({ success: true, results });
}
