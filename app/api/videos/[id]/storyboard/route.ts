import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { creditErrorStatus } from '@/lib/render-credit';
import { readJsonFile } from '@/lib/storage';
import type { VideoProject } from '@/lib/types';
import { regenerateStoryboard } from '@/lib/videos';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiRole(['video']);
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
      amount: 10,
      relatedType: 'pipeline',
      relatedId: params.id,
      note: `重生成分镜：${project.title}`
    });

    let result;
    try {
      result = await regenerateStoryboard(params.id);
      await captureReservation(reservation.reservationId, '分镜重生成完成');
    } catch (error) {
      await refundReservation(reservation.reservationId, '分镜重生成失败');
      throw error;
    }

    await appendAuditLog({
      actor: auth.user,
      action: 'video_project.storyboard.regenerate',
      targetType: 'video_project',
      targetId: params.id,
      summary: `重生成分镜：${result.project.title}`
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to regenerate storyboard' },
      { status: creditErrorStatus(error) }
    );
  }
}
