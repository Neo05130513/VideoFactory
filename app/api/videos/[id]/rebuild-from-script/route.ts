import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { creditErrorStatus } from '@/lib/render-credit';
import { readJsonFile } from '@/lib/storage';
import type { Script, VideoProject } from '@/lib/types';
import { regenerateStoryboardFromScript } from '@/lib/videos';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiRole(['video']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const scriptId = body.scriptId as string | undefined;

    if (!scriptId) {
      return NextResponse.json({ error: 'scriptId is required' }, { status: 400 });
    }

    const [projects, scripts] = await Promise.all([
      readJsonFile<VideoProject[]>('data/video-projects.json'),
      readJsonFile<Script[]>('data/scripts.json')
    ]);
    const project = projects.find((item) => item.id === params.id);
    const script = scripts.find((item) => item.id === scriptId);
    if (!project) {
      return NextResponse.json({ error: 'Video project not found' }, { status: 404 });
    }
    if (!script) {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }
    assertCanAccessOwnedRecord(auth.user, project.ownerUserId, 'video project');
    assertCanAccessOwnedRecord(auth.user, script.ownerUserId, 'script');

    const reservation = await reserveCredits({
      user: auth.user,
      amount: 10,
      relatedType: 'pipeline',
      relatedId: params.id,
      note: `按脚本重建分镜：${project.title}`
    });

    let result;
    try {
      result = await regenerateStoryboardFromScript(params.id, scriptId);
      await captureReservation(reservation.reservationId, '按脚本重建分镜完成');
    } catch (error) {
      await refundReservation(reservation.reservationId, '按脚本重建分镜失败');
      throw error;
    }

    await appendAuditLog({
      actor: auth.user,
      action: 'video_project.rebuild_from_script',
      targetType: 'video_project',
      targetId: params.id,
      summary: `按脚本版本重建项目：${result.project.title}`
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rebuild project from script' },
      { status: creditErrorStatus(error) }
    );
  }
}
