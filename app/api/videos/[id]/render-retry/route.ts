import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { refundReservation, reserveCredits } from '@/lib/credits';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { creditErrorStatus, estimateProjectRenderCredits } from '@/lib/render-credit';
import { retryRenderJob } from '@/lib/render-jobs';
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

    const reservation = await reserveCredits({
      user: auth.user,
      amount: await estimateProjectRenderCredits(params.id),
      relatedType: 'render',
      relatedId: params.id,
      note: `重试渲染视频：${project.title}`
    });

    let job;
    try {
      job = await retryRenderJob(params.id, {
        ownerUserId: project.ownerUserId || auth.user.id,
        creditReservationId: reservation.reservationId
      });
    } catch (error) {
      await refundReservation(reservation.reservationId, '重试渲染未入队');
      throw error;
    }

    await appendAuditLog({
      actor: auth.user,
      action: 'video_project.render.retry',
      targetType: 'video_project',
      targetId: params.id,
      summary: `重试渲染任务：${params.id}`
    });
    return NextResponse.json({ ok: true, job }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retry render job' },
      { status: creditErrorStatus(error) }
    );
  }
}
