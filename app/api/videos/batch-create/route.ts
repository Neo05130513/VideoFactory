import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { estimateRenderReservationCredits } from '@/lib/billing';
import { refundReservation, reserveCredits } from '@/lib/credits';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { creditErrorStatus } from '@/lib/render-credit';
import { enqueueRenderJobs } from '@/lib/render-jobs';
import { readJsonFile } from '@/lib/storage';
import { createVideoProjectsBatch } from '@/lib/videos';
import type { Script, VideoAspectRatio, VideoTemplate } from '@/lib/types';

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

    const scripts = await readJsonFile<Script[]>('data/scripts.json');
    const scriptById = new Map(scripts.map((script) => [script.id, script]));
    for (const scriptId of scriptIds) {
      const script = scriptById.get(scriptId);
      if (!script) {
        return NextResponse.json({ error: `Script not found: ${scriptId}` }, { status: 404 });
      }
      assertCanAccessOwnedRecord(auth.user, script.ownerUserId, 'script');
    }

    const results = await createVideoProjectsBatch(scriptIds, { aspectRatio, template });
    const creditReservationByProjectId: Record<string, string | undefined> = {};
    const ownerUserIdByProjectId: Record<string, string | undefined> = {};
    const reservedIds: string[] = [];
    try {
      for (const item of results) {
        const reservation = await reserveCredits({
          user: auth.user,
          amount: estimateRenderReservationCredits(item.scenes, 'imageVoice'),
          relatedType: 'render',
          relatedId: item.project.id,
          note: `批量渲染视频：${item.project.title}`
        });
        creditReservationByProjectId[item.project.id] = reservation.reservationId;
        ownerUserIdByProjectId[item.project.id] = item.project.ownerUserId || auth.user.id;
        if (reservation.reservationId) reservedIds.push(reservation.reservationId);
      }
    } catch (error) {
      await Promise.all(reservedIds.map((reservationId) => refundReservation(reservationId, '批量视频未入队').catch(() => undefined)));
      throw error;
    }

    let jobs;
    try {
      jobs = await enqueueRenderJobs(results.map((item) => item.project.id), {
        creditReservationByProjectId,
        ownerUserIdByProjectId
      });
    } catch (error) {
      await Promise.all(reservedIds.map((reservationId) => refundReservation(reservationId, '批量视频未入队').catch(() => undefined)));
      throw error;
    }

    await Promise.all(results.map((item) => appendAuditLog({
      actor: auth.user,
      action: 'video_project.batch_create',
      targetType: 'video_project',
      targetId: item.project.id,
      summary: `批量创建视频项目：${item.project.title}`
    })));
    return NextResponse.json({ results, jobs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to batch create video projects' },
      { status: creditErrorStatus(error) }
    );
  }
}
