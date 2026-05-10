import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { createVideoProjectFromScript } from '@/lib/videos';
import type { VideoAspectRatio, VideoTemplate } from '@/lib/types';

const templateOptions = new Set<VideoTemplate>(['tutorial-demo-v1', 'tech-explainer-v1', 'ai-explainer-short-v1', 'hyperframes-explainer-v1']);

export async function POST(request: Request) {
  const auth = await requireApiRole(['content', 'video']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const scriptId = body.scriptId as string | undefined;
    const aspectRatio = body.aspectRatio === '16:9' ? '16:9' as VideoAspectRatio : '9:16' as VideoAspectRatio;
    const template = templateOptions.has(body.template) ? body.template as VideoTemplate : 'ai-explainer-short-v1' as VideoTemplate;

    if (!scriptId) {
      return NextResponse.json({ error: 'scriptId is required' }, { status: 400 });
    }

    const result = await createVideoProjectFromScript(scriptId, { aspectRatio, template });
    await appendAuditLog({
      actor: auth.user,
      action: 'video_project.create',
      targetType: 'video_project',
      targetId: result.project.id,
      summary: `从脚本创建视频项目：${result.project.title}`
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create video project' },
      { status: 500 }
    );
  }
}
