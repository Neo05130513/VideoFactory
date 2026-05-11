import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { readJsonFile } from '@/lib/storage';
import type { VideoProject } from '@/lib/types';
import { deleteVideoProject } from '@/lib/videos';

export async function DELETE(
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

    const result = await deleteVideoProject(params.id);
    await appendAuditLog({
      actor: auth.user,
      action: 'video_project.delete',
      targetType: 'video_project',
      targetId: params.id,
      summary: `删除视频项目：${result.project.title}`
    });
    return NextResponse.json({ ok: true, project: result.project });
  } catch (error) {
    if (error instanceof Error && /^Forbidden/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete video project' },
      { status: 500 }
    );
  }
}
