import { processTutorialPipeline } from './pipeline';
import { nowIso, readJsonFile, simpleId, writeJsonFile } from './storage';
import type { PipelineJob, PipelineJobResult } from './types';

const PIPELINE_JOBS_PATH = 'data/pipeline-jobs.json';

type PipelineRuntimeStore = {
  controllers: Map<string, AbortController>;
  processing: boolean;
  liveJobs: Map<string, PipelineJob>;
  listeners: Map<string, Set<(job: PipelineJob) => void>>;
};

function getRuntimeStore() {
  const globalStore = globalThis as typeof globalThis & {
    __videoFactoryPipelineRuntime?: Partial<PipelineRuntimeStore>;
  };
  const current = globalStore.__videoFactoryPipelineRuntime;
  const runtime: PipelineRuntimeStore = {
    controllers: current?.controllers instanceof Map ? current.controllers : new Map<string, AbortController>(),
    processing: typeof current?.processing === 'boolean' ? current.processing : false,
    liveJobs: current?.liveJobs instanceof Map ? current.liveJobs : new Map<string, PipelineJob>(),
    listeners: current?.listeners instanceof Map ? current.listeners : new Map<string, Set<(job: PipelineJob) => void>>()
  };
  globalStore.__videoFactoryPipelineRuntime = runtime;
  return runtime;
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function readJobs() {
  try {
    return await readJsonFile<PipelineJob[]>(PIPELINE_JOBS_PATH);
  } catch {
    return [];
  }
}

async function writeJobs(jobs: PipelineJob[]) {
  await writeJsonFile(PIPELINE_JOBS_PATH, jobs);
}

function cloneJob(job: PipelineJob) {
  return JSON.parse(JSON.stringify(job)) as PipelineJob;
}

function publishJob(job: PipelineJob) {
  const runtime = getRuntimeStore();
  const nextJob = cloneJob(job);
  runtime.liveJobs.set(job.id, nextJob);
  const listeners = runtime.listeners.get(job.id);
  if (!listeners?.size) return;
  for (const listener of listeners) {
    try {
      listener(cloneJob(nextJob));
    } catch {
    }
  }
}

async function persistJob(updated: PipelineJob) {
  const jobs = await readJobs();
  const nextJobs = jobs.map((job) => job.id === updated.id ? updated : job);
  await writeJobs(nextJobs);
}

function summarizeResult(result: Awaited<ReturnType<typeof processTutorialPipeline>>): PipelineJobResult {
  const firstScript = result.scripts[0];

  return {
    tutorialId: result.tutorial.id,
    tutorialTitle: result.tutorial.title,
    topicCount: result.topics.length,
    scriptCount: result.scripts.length,
    scripts: result.scripts.map((script) => ({
      id: script.id,
      title: script.title,
      hook: script.hook
    })),
    firstScriptId: firstScript?.id,
    firstScriptTitle: firstScript?.title
  };
}

async function updatePipelineJob(jobId: string, patch: Partial<PipelineJob>, options?: { persist?: boolean }) {
  const runtime = getRuntimeStore();
  const timestamp = patch.updatedAt || nowIso();
  const current = runtime.liveJobs.get(jobId) || (await readJobs()).find((job) => job.id === jobId) || null;
  if (!current) return null;

  const updated: PipelineJob = {
    ...current,
    ...patch,
    progress: typeof patch.progress === 'number' ? clampProgress(patch.progress) : current.progress,
    streamText: typeof patch.streamText === 'string' ? patch.streamText : patch.streamText === undefined ? current.streamText : undefined,
    streamUpdatedAt: typeof patch.streamText === 'string'
      ? timestamp
      : patch.streamText === undefined
        ? current.streamUpdatedAt
        : undefined,
    updatedAt: timestamp
  };

  publishJob(updated);
  if (options?.persist !== false) {
    await persistJob(updated);
  }
  return updated;
}

export async function enqueuePipelineJob(tutorialId: string) {
  const runtime = getRuntimeStore();
  const jobs = await readJobs();
  const existing = jobs.find((job) => job.tutorialId === tutorialId && (job.status === 'queued' || job.status === 'running'));
  if (existing) {
    // Older jobs may still reflect the retired multi-topic flow. Replace them
    // so a fresh request uses the current single-topic pipeline.
    if ((existing.totalTopics || 0) > 1) {
      await cancelPipelineJob(existing.id);
    } else {
      if (existing.status === 'queued') {
        void processPipelineQueue();
      }
      return existing;
    }
  }

  const now = nowIso();
  const job: PipelineJob = {
    id: simpleId('pipeline_job'),
    tutorialId,
    status: 'queued',
    stage: 'queued',
    progress: 4,
    detail: '任务已进入队列，等待开始。',
    createdAt: now,
    updatedAt: now
  };

  await writeJobs([job, ...jobs]);
  runtime.liveJobs.set(job.id, cloneJob(job));
  void processPipelineQueue();
  return job;
}

export async function getPipelineJob(jobId: string) {
  const runtime = getRuntimeStore();
  const jobs = await readJobs();
  const persistedJob = jobs.find((job) => job.id === jobId);
  if (!persistedJob) return null;
  const liveJob = runtime.liveJobs.get(jobId);
  const mergedJob = !liveJob
    ? persistedJob
    : cloneJob({
      ...persistedJob,
      ...liveJob,
      progress: typeof liveJob.progress === 'number' ? liveJob.progress : persistedJob.progress,
      streamText: liveJob.streamText ?? persistedJob.streamText,
      streamUpdatedAt: liveJob.streamUpdatedAt ?? persistedJob.streamUpdatedAt
    });

  if (mergedJob.status === 'queued') {
    void processPipelineQueue();
  }

  return cloneJob(mergedJob);
}

export function subscribePipelineJob(jobId: string, listener: (job: PipelineJob) => void) {
  const runtime = getRuntimeStore();
  const listeners = runtime.listeners.get(jobId) || new Set<(job: PipelineJob) => void>();
  listeners.add(listener);
  runtime.listeners.set(jobId, listeners);

  return () => {
    const current = runtime.listeners.get(jobId);
    if (!current) return;
    current.delete(listener);
    if (!current.size) {
      runtime.listeners.delete(jobId);
    }
  };
}

export async function cancelPipelineJob(jobId: string) {
  const runtime = getRuntimeStore();
  const jobs = await readJobs();
  const current = jobs.find((job) => job.id === jobId);
  if (!current) return null;

  if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
    return current;
  }

  if (current.status === 'queued') {
    const cancelled: PipelineJob = {
      ...current,
      status: 'cancelled',
      stage: 'cancelled',
      progress: 100,
      detail: '用户已停止脚本生成。',
      error: '用户已停止脚本生成',
      completedAt: nowIso(),
      updatedAt: nowIso()
    };
    await writeJobs(jobs.map((job) => job.id === jobId ? cancelled : job));
    publishJob(cancelled);
    return cancelled;
  }

  const controller = runtime.controllers.get(jobId);
  controller?.abort('用户已停止脚本生成');
  return await updatePipelineJob(jobId, {
    stage: 'cancelling',
    detail: '正在停止脚本生成...',
    error: '用户已停止脚本生成'
  });
}

export async function processPipelineQueue() {
  const runtime = getRuntimeStore();
  if (runtime.processing) return null;

  const jobs = await readJobs();
  const nextJob = jobs.find((job) => job.status === 'queued');
  if (!nextJob) return null;

  runtime.processing = true;
  try {
    const controller = new AbortController();
    runtime.controllers.set(nextJob.id, controller);
    runtime.liveJobs.set(nextJob.id, cloneJob(nextJob));

    await updatePipelineJob(nextJob.id, {
      status: 'running',
      stage: 'starting',
      progress: Math.max(nextJob.progress, 8),
      startedAt: nowIso(),
      detail: '任务已开始，正在准备处理文档。',
      error: undefined
    });

    const result = await processTutorialPipeline(nextJob.tutorialId, {
      signal: controller.signal,
      onProgress: async (progress) => {
        await updatePipelineJob(nextJob.id, {
          stage: progress.stage,
          progress: progress.progress,
          detail: progress.detail,
          previewText: progress.previewText,
          streamText: progress.streamText,
          currentTopicTitle: progress.currentTopicTitle,
          currentTopicIndex: progress.currentTopicIndex,
          totalTopics: progress.totalTopics,
          attempt: progress.attempt,
          maxAttempts: progress.maxAttempts,
          elapsedMs: progress.elapsedMs
        }, {
          persist: progress.persist !== false
        });
      }
    });

    const summary = summarizeResult(result);
    await updatePipelineJob(nextJob.id, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      detail: `已完成，生成 ${summary.scriptCount} 条脚本。`,
      result: summary,
      completedAt: nowIso(),
      error: undefined
    });
    return await getPipelineJob(nextJob.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : '教程处理失败';
    const controller = runtime.controllers.get(nextJob.id);
    if (controller?.signal.aborted || message === '用户已停止脚本生成') {
      await updatePipelineJob(nextJob.id, {
        status: 'cancelled',
        stage: 'cancelled',
        progress: 100,
        error: '用户已停止脚本生成',
        detail: '用户已停止脚本生成。',
        completedAt: nowIso()
      });
      return await getPipelineJob(nextJob.id);
    }

    await updatePipelineJob(nextJob.id, {
      status: 'failed',
      stage: 'failed',
      progress: 100,
      error: message,
      detail: message,
      completedAt: nowIso()
    });
    return await getPipelineJob(nextJob.id);
  } finally {
    runtime.controllers.delete(nextJob.id);
    runtime.processing = false;
    const latestJobs = await readJobs();
    if (latestJobs.some((job) => job.status === 'queued')) {
      void processPipelineQueue();
    }
  }
}
