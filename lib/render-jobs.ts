import { nowIso, readJsonFile, simpleId, writeJsonFile } from './storage';
import { renderVideoProjectWithRemotion } from './remotion-renderer';
import { getPerformanceSettings } from './performance/settings';
import { captureReservation, refundReservation } from './credits';
import type { RenderJob, VideoProject } from './types';

const DEFAULT_MAX_ATTEMPTS = 2;
const LOW_MEMORY_RETRY_MS = 30_000;

let lowMemoryRetryTimer: ReturnType<typeof setTimeout> | null = null;

async function readJobs() {
  try {
    const jobs = await readJsonFile<Array<Partial<RenderJob> & Pick<RenderJob, 'id' | 'projectId' | 'status' | 'createdAt' | 'updatedAt'>>>('data/render-jobs.json');
    return jobs.map((job) => ({
      ...job,
      attempt: job.attempt || 0,
      maxAttempts: job.maxAttempts || DEFAULT_MAX_ATTEMPTS
    })) as RenderJob[];
  } catch {
    return [];
  }
}

async function writeJobs(jobs: RenderJob[]) {
  await writeJsonFile('data/render-jobs.json', jobs);
}

async function updateJobProgress(jobId: string, patch: Partial<Pick<RenderJob, 'stage' | 'progress' | 'error' | 'updatedAt'>>) {
  const jobs = await readJobs();
  const timestamp = nowIso();
  await writeJobs(jobs.map((job) => job.id === jobId ? {
    ...job,
    ...patch,
    progress: typeof patch.progress === 'number' ? Math.max(0, Math.min(100, Math.round(patch.progress))) : job.progress,
    updatedAt: patch.updatedAt || timestamp
  } : job));
}

export async function enqueueRenderJob(projectId: string, options: { force?: boolean; maxAttempts?: number; ownerUserId?: string; creditReservationId?: string } = {}) {
  const jobs = await readJobs();
  const activeJob = jobs.find((job) => job.projectId === projectId && (job.status === 'queued' || job.status === 'running'));
  if (activeJob && !options.force) return activeJob;

  const now = nowIso();
  const job: RenderJob = {
    id: simpleId('render_job'),
    ownerUserId: options.ownerUserId,
    creditReservationId: options.creditReservationId,
    projectId,
    status: 'queued',
    attempt: 0,
    maxAttempts: options.maxAttempts || DEFAULT_MAX_ATTEMPTS,
    stage: 'queued',
    progress: 8,
    createdAt: now,
    updatedAt: now
  };

  await writeJobs([job, ...jobs]);
  void processRenderQueue();
  return job;
}

export async function enqueueRenderJobs(projectIds: string[], options: { force?: boolean; maxAttempts?: number; ownerUserId?: string; ownerUserIdByProjectId?: Record<string, string | undefined>; creditReservationByProjectId?: Record<string, string | undefined> } = {}) {
  const jobs: RenderJob[] = [];
  for (const projectId of projectIds) {
    jobs.push(await enqueueRenderJob(projectId, {
      force: options.force,
      maxAttempts: options.maxAttempts,
      ownerUserId: options.ownerUserIdByProjectId?.[projectId] || options.ownerUserId,
      creditReservationId: options.creditReservationByProjectId?.[projectId]
    }));
  }
  return jobs;
}

export async function getLatestRenderJob(projectId: string) {
  const jobs = await readJobs();
  return jobs.find((job) => job.projectId === projectId) || null;
}

export async function retryRenderJob(projectId: string, options: { ownerUserId?: string; creditReservationId?: string } = {}) {
  return enqueueRenderJob(projectId, {
    force: true,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    ownerUserId: options.ownerUserId,
    creditReservationId: options.creditReservationId
  });
}

async function markProjectStopped(projectId: string, message: string) {
  const projects = await readJsonFile<VideoProject[]>('data/video-projects.json');
  await writeJsonFile('data/video-projects.json', projects.map((project) => project.id === projectId ? {
    ...project,
    status: 'failed',
    lastError: message,
    updatedAt: nowIso(),
    publishTier: 'blocked'
  } : project));
}

export async function cancelRenderJob(projectId: string) {
  const jobs = await readJobs();
  const hasRunningJob = jobs.some((job) => job.projectId === projectId && job.status === 'running');
  const timestamp = nowIso();
  const nextJobs = jobs.map((job) => {
    if (job.projectId !== projectId || (job.status !== 'queued' && job.status !== 'running')) return job;
    return {
      ...job,
      status: 'cancelled' as const,
      completedAt: timestamp,
      updatedAt: timestamp,
      stage: 'cancelled',
      progress: 100,
      error: '用户已停止生成'
    };
  });
  await writeJobs(nextJobs);
  await Promise.all(nextJobs
    .filter((job) => job.projectId === projectId && job.status === 'cancelled')
    .map((job) => refundReservation(job.creditReservationId, 'Render cancelled').catch(() => undefined)));
  await markProjectStopped(projectId, '用户已停止生成');
  if (!hasRunningJob) void processRenderQueue();
  return nextJobs.find((job) => job.projectId === projectId) || null;
}

export async function processRenderQueue() {
  const jobs = await readJobs();
  const { settings, device } = await getPerformanceSettings();
  if (settings.autoPauseOnLowMemory && device.freeMemoryGb < settings.lowMemoryThresholdGb) {
    const nextQueuedJob = jobs.find((job) => job.status === 'queued');
    if (nextQueuedJob) {
      const message = `可用内存 ${device.freeMemoryGb}GB，低于暂停阈值 ${settings.lowMemoryThresholdGb}GB，正在等待内存释放。`;
      await writeJobs(jobs.map((job) => job.id === nextQueuedJob.id ? {
        ...job,
        stage: 'waiting-for-memory',
        progress: job.progress || 8,
        error: message,
        updatedAt: nowIso()
      } : job));
    }
    if (!lowMemoryRetryTimer) {
      lowMemoryRetryTimer = setTimeout(() => {
        lowMemoryRetryTimer = null;
        void processRenderQueue();
      }, LOW_MEMORY_RETRY_MS);
    }
    return null;
  }

  const runningJobs = jobs.filter((job) => job.status === 'running');
  if (runningJobs.length >= settings.renderConcurrency) return runningJobs[0];

  const nextJob = jobs.find((job) => job.status === 'queued');
  if (!nextJob) return null;

  const startedAt = nowIso();
  const runningJob: RenderJob = {
    ...nextJob,
    status: 'running',
    attempt: nextJob.attempt + 1,
    stage: 'starting',
    progress: Math.max(nextJob.progress || 0, 18),
    startedAt,
    updatedAt: startedAt,
    error: undefined
  };
  await writeJobs(jobs.map((job) => (job.id === nextJob.id ? runningJob : job)));

  try {
    await updateJobProgress(nextJob.id, { stage: 'rendering-remotion', progress: 42 });
    const result = await renderVideoProjectWithRemotion(nextJob.projectId, {
      onProgress: (progress) => updateJobProgress(nextJob.id, {
        stage: progress.stage,
        progress: progress.progress,
        error: progress.detail
      })
    });
    const latest = (await readJobs()).find((job) => job.id === nextJob.id);
    if (latest?.status === 'cancelled') {
      await markProjectStopped(nextJob.projectId, '用户已停止生成');
      void processRenderQueue();
      return latest;
    }
    const completedAt = nowIso();
    if (result.remotionReady) {
      await captureReservation(runningJob.creditReservationId, 'Render completed');
    } else {
      await refundReservation(runningJob.creditReservationId, 'Render failed');
    }
    const completedJob: RenderJob = {
      ...runningJob,
      status: result.remotionReady ? 'completed' : 'failed',
      completedAt,
      updatedAt: completedAt,
      outputPath: result.project.outputPath,
      stage: result.remotionReady ? 'completed' : 'failed',
      progress: result.remotionReady ? 100 : 100,
      error: result.remotionReady ? undefined : result.project.lastError
    };
    await writeJobs((await readJobs()).map((job) => (job.id === nextJob.id ? completedJob : job)));
    void processRenderQueue();
    return completedJob;
  } catch (error) {
    const latest = (await readJobs()).find((job) => job.id === nextJob.id);
    if (latest?.status === 'cancelled') {
      await markProjectStopped(nextJob.projectId, '用户已停止生成');
      void processRenderQueue();
      return latest;
    }
    const failedAt = nowIso();
    const message = error instanceof Error ? error.message : 'Render job failed';
    const shouldRetry = runningJob.attempt < runningJob.maxAttempts;
    if (!shouldRetry) {
      await refundReservation(runningJob.creditReservationId, 'Render failed');
    }
    const failedJob: RenderJob = {
      ...runningJob,
      status: shouldRetry ? 'queued' : 'failed',
      completedAt: shouldRetry ? undefined : failedAt,
      updatedAt: failedAt,
      stage: shouldRetry ? 'retrying' : 'failed',
      progress: shouldRetry ? 18 : 100,
      error: shouldRetry ? `Attempt ${runningJob.attempt} failed, retrying: ${message}` : message
    };
    await writeJobs((await readJobs()).map((job) => (job.id === nextJob.id ? failedJob : job)));
    void processRenderQueue();
    return failedJob;
  }
}
