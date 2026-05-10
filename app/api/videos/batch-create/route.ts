import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { createVideoProjectsBatch } from '@/lib/videos';
import type { VideoAspectRatio, VideoTemplate } from '@/lib/types';

const templateOptions = new Set<VideoTemplate>(['tutorial-demo-v1', 'tech-explainer-v1', 'ai-explainer-short-v1', 'hyperframes-explainer-v1']);

export async function POST(request: Request) {
  const auth = await requireApiRole(['video']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const scriptIds = body.scriptIds as string[] | undefined;
    const aspectRatio = body.aspectRatio === '16:9' ? '16:9' as VideoAspectRatio : '9:16' as VideoAspectRatio;
    const template = templateOptions.has(body.template) ? body.template as VideoTemplate : 'ai-explainer-short-v1' as VideoTemplate;

    if (!Array.isArray(scriptIds) || scriptIds.length === 0) {
      return NextResponse.json({ error: 'scriptIds is required' }, { status: 400 });
    }

    const results = await createVideoProjectsBatch(scriptIds, { aspectRatio, template });
    await Promise.all(results.map((item) => appendAuditLog({
      actor: auth.user,
      action: 'video_project.batch_create',
      targetType: 'video_project',
      targetId: item.project.id,
      summary: `批量创建视频项目：${item.project.title}`
    })));
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to batch create video projects' },
      { status: 500 }
    );
  }
}
