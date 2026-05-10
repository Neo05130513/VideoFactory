import { NextResponse } from 'next/server';
import { getVideoRuntimeStatus } from '@/lib/queries';

export async function GET() {
  const runtimeStatus = await getVideoRuntimeStatus();

  return NextResponse.json({
    ok: true,
    source: 'probe-route',
    timestamp: new Date().toISOString(),
    runtime: runtimeStatus,
    env: {
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
      minimaxConfigured: Boolean(process.env.MINIMAX_API_KEY),
      minimaxHost: process.env.MINIMAX_API_HOST || process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com'
    }
  });
}
