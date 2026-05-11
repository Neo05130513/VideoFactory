import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { cancelRenderJob } from '@/lib/render-jobs';
import { readJsonFile } from '@/lib/storage';
import type { VideoProject } from '@/lib/types';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiRole(['content', 'video']);
  if (!auth.ok) return auth.response;

  try {
    const projects = await readJsonFile<VideoProject[]>('data/video-projects.json');
    const project = projects.find((item) => item.id === params.id);
    if (!project) {
      return NextResponse.json({ error: 'Video project not found' }, { status: 404 });
    }
    assertCanAccessOwnedRecord(auth.user, project.ownerUserId, 'video project');

    const job = await cancelRenderJob(params.id);
    await appendAuditLog({
      actor: auth.user,
      action: 'video_project.render.cancel',
      targetType: 'video_project',
      targetId: params.id,
      summary: `停止视频生成：${params.id}`
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    if (error instanceof Error && /^Forbidden/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel render job' },
      { status: 500 }
    );
  }
}
