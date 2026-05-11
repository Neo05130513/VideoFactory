import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { estimateRenderReservationCredits } from '@/lib/billing';
import { refundReservation, reserveCredits } from '@/lib/credits';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { creditErrorStatus } from '@/lib/render-credit';
import { enqueueRenderJob } from '@/lib/render-jobs';
import { readJsonFile } from '@/lib/storage';
import { createVideoProjectFromScript } from '@/lib/videos';
import type { Script, VideoAspectRatio, VideoTemplate } from '@/lib/types';

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

    const scripts = await readJsonFile<Script[]>('data/scripts.json');
    const script = scripts.find((item) => item.id === scriptId);
    if (!script) {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }
    assertCanAccessOwnedRecord(auth.user, script.ownerUserId, 'script');

    const result = await createVideoProjectFromScript(scriptId, { aspectRatio, template });
    const reservation = await reserveCredits({
      user: auth.user,
      amount: estimateRenderReservationCredits(result.scenes, 'imageVoice'),
      relatedType: 'render',
      relatedId: result.project.id,
      note: `渲染视频：${result.project.title}`
    });

    let job;
    try {
      job = await enqueueRenderJob(result.project.id, {
        ownerUserId: result.project.ownerUserId || auth.user.id,
        creditReservationId: reservation.reservationId
      });
    } catch (error) {
      await refundReservation(reservation.reservationId, '视频渲染未入队');
      throw error;
    }

    await appendAuditLog({
      actor: auth.user,
      action: 'video_project.create',
      targetType: 'video_project',
      targetId: result.project.id,
      summary: `从脚本创建视频项目：${result.project.title}`
    });
    return NextResponse.json({ ...result, job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create video project' },
      { status: creditErrorStatus(error) }
    );
  }
}
