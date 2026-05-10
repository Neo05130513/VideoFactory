import { NextResponse } from 'next/server';
import { getLatestRenderJob, processRenderQueue } from '@/lib/render-jobs';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  void processRenderQueue();
  const job = await getLatestRenderJob(params.id);
  return NextResponse.json({ ok: true, job });
}
