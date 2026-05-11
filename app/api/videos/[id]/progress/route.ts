import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { getRenderJobs, getVideoAssets, getVideoProjects, getVideoScenes } from '@/lib/queries';
import { getVideoProgressSnapshot } from '@/lib/video-progress';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiRole(['content', 'video']);
  if (!auth.ok) return auth.response;

  const [projects, scenes, assets, jobs] = await Promise.all([
    getVideoProjects(),
    getVideoScenes(),
    getVideoAssets(),
    getRenderJobs().catch(() => [])
  ]);
  const project = projects.find((item) => item.id === params.id);
  if (!project) return NextResponse.json({ error: 'Video project not found' }, { status: 404 });

  const projectScenes = scenes.filter((item) => item.projectId === project.id);
  const projectAssets = assets.filter((item) => item.projectId === project.id);
  const latestJob = jobs
    .filter((job) => job.projectId === project.id)
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))[0] || null;

  return NextResponse.json({
    project: {
      id: project.id,
      status: project.status,
      lastError: project.lastError
    },
    job: latestJob,
    progress: getVideoProgressSnapshot({
      project,
      job: latestJob,
      scenes: projectScenes,
      assets: projectAssets
    })
  });
}
