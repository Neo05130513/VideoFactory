import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { canAccessOwnedRecord } from '@/lib/ownership';
import { cancelPipelineJob, getPipelineJob } from '@/lib/pipeline-jobs';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiRole(['content', 'video']);
  if (!auth.ok) return auth.response;

  const job = await getPipelineJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Pipeline job not found' }, { status: 404 });
  }
  if (!canAccessOwnedRecord(auth.user, job.ownerUserId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ job });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiRole(['content', 'video']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'cancel') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const existing = await getPipelineJob(params.id);
    if (existing && !canAccessOwnedRecord(auth.user, existing.ownerUserId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const job = await cancelPipelineJob(params.id);
    if (!job) {
      return NextResponse.json({ error: 'Pipeline job not found' }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '取消脚本任务失败' },
      { status: 500 }
    );
  }
}
