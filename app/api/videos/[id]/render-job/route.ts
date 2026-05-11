import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { getLatestRenderJob, processRenderQueue } from '@/lib/render-jobs';
import { readJsonFile } from '@/lib/storage';
import type { VideoProject } from '@/lib/types';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiRole(['content', 'video']);
  if (!auth.ok) return auth.response;

  const projects = await readJsonFile<VideoProject[]>('data/video-projects.json');
  const project = projects.find((item) => item.id === params.id);
  if (!project) return NextResponse.json({ error: 'Video project not found' }, { status: 404 });
  try {
    assertCanAccessOwnedRecord(auth.user, project.ownerUserId, 'video project');
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Forbidden video project' },
      { status: 403 }
    );
  }

  void processRenderQueue();
  const job = await getLatestRenderJob(params.id);
  return NextResponse.json({ ok: true, job });
}
