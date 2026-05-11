import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { refundReservation, reserveCredits } from '@/lib/credits';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { creditErrorStatus, estimateProjectRenderCredits, isActiveRenderStatus } from '@/lib/render-credit';
import { enqueueRenderJobs, getLatestRenderJob } from '@/lib/render-jobs';
import { readJsonFile } from '@/lib/storage';
import type { VideoProject } from '@/lib/types';

export async function POST(request: Request) {
  const auth = await requireApiRole(['video']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const projectIds = body.projectIds as string[] | undefined;
    const force = Boolean(body.force);

    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return NextResponse.json({ error: 'projectIds is required' }, { status: 400 });
    }

    const projects = await readJsonFile<VideoProject[]>('data/video-projects.json');
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const creditReservationByProjectId: Record<string, string | undefined> = {};
    const ownerUserIdByProjectId: Record<string, string | undefined> = {};
    const reservedIds: string[] = [];

    try {
      for (const projectId of projectIds) {
        const project = projectById.get(projectId);
        if (!project) {
          throw new Error(`Video project not found: ${projectId}`);
        }
        assertCanAccessOwnedRecord(auth.user, project.ownerUserId, 'video project');
        ownerUserIdByProjectId[projectId] = project.ownerUserId || auth.user.id;

        const activeJob = await getLatestRenderJob(projectId);
        if (!force && isActiveRenderStatus(activeJob?.status)) {
          continue;
        }

        const reservation = await reserveCredits({
          user: auth.user,
          amount: await estimateProjectRenderCredits(projectId),
          relatedType: 'render',
          relatedId: projectId,
          note: `${force ? '重试' : '提交'}批量渲染：${project.title}`
        });
        creditReservationByProjectId[projectId] = reservation.reservationId;
        if (reservation.reservationId) reservedIds.push(reservation.reservationId);
      }
    } catch (error) {
      await Promise.all(reservedIds.map((reservationId) => refundReservation(reservationId, '批量渲染未入队').catch(() => undefined)));
      throw error;
    }

    let jobs;
    try {
      jobs = await enqueueRenderJobs(projectIds, {
        force,
        creditReservationByProjectId,
        ownerUserIdByProjectId
      });
      await Promise.all(jobs.map((job) => {
        const reservationId = creditReservationByProjectId[job.projectId];
        if (reservationId && job.creditReservationId !== reservationId) {
          return refundReservation(reservationId, '已有渲染任务，退回重复预占').catch(() => undefined);
        }
        return Promise.resolve();
      }));
    } catch (error) {
      await Promise.all(reservedIds.map((reservationId) => refundReservation(reservationId, '批量渲染未入队').catch(() => undefined)));
      throw error;
    }

    await Promise.all(projectIds.map((projectId) => appendAuditLog({
      actor: auth.user,
      action: force ? 'video_project.batch_render.retry' : 'video_project.batch_render.enqueue',
      targetType: 'video_project',
      targetId: projectId,
      summary: `${force ? '重试' : '提交'}批量渲染任务：${projectId}`
    })));
    return NextResponse.json({ ok: true, jobs }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to enqueue batch render jobs' },
      { status: creditErrorStatus(error) }
    );
  }
}
