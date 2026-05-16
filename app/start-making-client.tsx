'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatApiClientError, readApiJson } from './_components/api-client';
import { navigatePendingWindow, openPendingWindow } from './_components/open-new-window';
import { linkButtonStyle, newWindowLinkProps, primaryButtonStyle, secondaryButtonStyle, StatusBadge, subtlePanelStyle } from './_components/studio-ui';
import { estimateGenerationFromText } from '@/lib/performance/estimate';
import type { PerformanceSettings } from '@/lib/performance/settings';
import type { PipelineJob } from '@/lib/types';

type VoiceProfileView = {
  id: string;
  name: string;
  provider: string;
  status: 'sample_uploaded' | 'ready' | 'failed';
  isDefault?: boolean;
  lastError?: string;
};

type StepState = 'idle' | 'waiting' | 'running' | 'done' | 'failed';
type ProgressStep = {
  id: string;
  title: string;
  desc: string;
  status: StepState;
  progress: number;
  detail?: string;
  href?: string;
};

function compactError(value: unknown) {
  const text = value instanceof Error ? value.message : String(value || '');
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

type PendingScriptConfirmation = {
  scriptId: string;
  title: string;
  href: string;
  hook: string;
};

type PipelineJobView = Pick<PipelineJob, 'id' | 'status' | 'stage' | 'progress' | 'detail' | 'previewText' | 'streamText' | 'currentTopicTitle' | 'currentTopicIndex' | 'totalTopics' | 'attempt' | 'maxAttempts' | 'elapsedMs' | 'createdAt' | 'updatedAt' | 'error' | 'result'>;

const initialSteps: ProgressStep[] = [
  { id: 'voice', title: '确认旁白音色', desc: '从我的素材中选择一个复刻完成的音色。', status: 'idle', progress: 0 },
  { id: 'import', title: '导入文档', desc: '上传文件或保存粘贴文本，生成文档素材。', status: 'idle', progress: 0 },
  { id: 'parse', title: '理解文档并撰写脚本', desc: '系统会解析文档内容，自动生成可用于讲解视频的脚本。', status: 'idle', progress: 0 },
  { id: 'project', title: '创建视频项目', desc: '确认脚本后，使用 OpenAI 整片生成 storyboard 和模板预览。', status: 'idle', progress: 0 },
  { id: 'render', title: '生成旁白、画面与成片', desc: '提交制作任务，生成音频、字幕和最终视频。', status: 'idle', progress: 0 },
  { id: 'review', title: '查看结果并继续修改', desc: '完成后可进入视频详情，检查脚本、分镜、资源和输出文件。', status: 'idle', progress: 0 }
];

const storageKey = 'video-factory:start-making-state:v3';
const legacyStorageKeys = ['video-factory:start-making-state:v1', 'video-factory:start-making-state:v2'];

function statusTone(status: StepState) {
  if (status === 'done') return 'success' as const;
  if (status === 'running') return 'info' as const;
  if (status === 'waiting') return 'warning' as const;
  if (status === 'failed') return 'danger' as const;
  return 'neutral' as const;
}

function statusText(status: StepState) {
  if (status === 'done') return '完成';
  if (status === 'running') return '进行中';
  if (status === 'waiting') return '待确认';
  if (status === 'failed') return '失败';
  return '等待';
}

function providerLabel(provider: string) {
  if (provider === 'aliyun-cosyvoice') return 'CosyVoice';
  if (provider === 'minimax') return 'MiniMax';
  return '自定义接口';
}

export function StartMakingClient({ initialProfiles, performanceSettings }: { initialProfiles: VoiceProfileView[]; performanceSettings: PerformanceSettings }) {
  const readyVoices = useMemo(() => initialProfiles.filter((profile) => profile.status === 'ready'), [initialProfiles]);
  const defaultVoice = readyVoices.find((profile) => profile.isDefault) || readyVoices[0];
  const [selectedVoiceId, setSelectedVoiceId] = useState(defaultVoice?.id || '');
  const [documents, setDocuments] = useState<File[]>([]);
  const [pastedTitle, setPastedTitle] = useState('粘贴文本');
  const [pastedText, setPastedText] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [autoRender, setAutoRender] = useState(true);
  const [backgroundRequested, setBackgroundRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<ProgressStep[]>(initialSteps);
  const [message, setMessage] = useState('');
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activePipelineJobId, setActivePipelineJobId] = useState('');
  const [pipelineJob, setPipelineJob] = useState<PipelineJobView | null>(null);
  const [pendingScript, setPendingScript] = useState<PendingScriptConfirmation | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const voiceSectionRef = useRef<HTMLElement | null>(null);
  const documentSectionRef = useRef<HTMLElement | null>(null);
  const generateSectionRef = useRef<HTMLElement | null>(null);
  const pipelineStreamRef = useRef<HTMLDivElement | null>(null);
  const pollingProjectRef = useRef<string | null>(null);
  const pollingPipelineJobRef = useRef<string | null>(null);
  const backgroundRequestedRef = useRef(false);
  const backgroundProjectRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);

  const selectedVoice = readyVoices.find((voice) => voice.id === selectedVoiceId);
  const hasDocumentInput = documents.length > 0 || pastedText.trim().length > 0;
  const canGenerate = Boolean(selectedVoiceId && hasDocumentInput && !busy && !pendingScript);
  const totalProgress = Math.round(steps.reduce((total, step) => total + step.progress, 0) / steps.length);
  const fileBytes = useMemo(() => documents.reduce((total, file) => total + file.size, 0), [documents]);
  const estimate = useMemo(() => estimateGenerationFromText({
    text: pastedText,
    fileCount: documents.length,
    fileBytes,
    autoRender,
    settings: performanceSettings
  }), [autoRender, documents.length, fileBytes, pastedText, performanceSettings]);
  const remainingEstimate = busy
    ? estimate.estimatedGenerationMaxMinutes <= 1
      ? '约 1 分钟内'
      : `约 ${Math.max(1, Math.ceil(estimate.estimatedGenerationMinMinutes * (1 - totalProgress / 100)))}-${Math.max(1, Math.ceil(estimate.estimatedGenerationMaxMinutes * (1 - totalProgress / 100)))} 分钟`
    : estimate.estimatedGenerationRange;

  useEffect(() => {
    try {
      legacyStorageKeys.forEach((key) => window.localStorage.removeItem(key));
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setHydrated(true);
        return;
      }
      const stored = JSON.parse(raw) as {
        selectedVoiceId?: string;
        pastedTitle?: string;
        pastedText?: string;
        aspectRatio?: '9:16' | '16:9';
        autoRender?: boolean;
        steps?: ProgressStep[];
        message?: string;
        activeProjectId?: string;
        activePipelineJobId?: string;
        pendingScript?: PendingScriptConfirmation | null;
      };
      if (stored.selectedVoiceId && readyVoices.some((voice) => voice.id === stored.selectedVoiceId)) setSelectedVoiceId(stored.selectedVoiceId);
      if (stored.pastedTitle) setPastedTitle(stored.pastedTitle);
      if (stored.pastedText) setPastedText(stored.pastedText);
      if (stored.aspectRatio === '9:16' || stored.aspectRatio === '16:9') setAspectRatio(stored.aspectRatio);
      if (typeof stored.autoRender === 'boolean') setAutoRender(stored.autoRender);
      if (Array.isArray(stored.steps)) setSteps(initialSteps.map((step) => ({ ...step, ...(stored.steps || []).find((item) => item.id === step.id) })));
      if (stored.message) setMessage(stored.message);
      if (stored.activeProjectId) setActiveProjectId(stored.activeProjectId);
      if (stored.activePipelineJobId) setActivePipelineJobId(stored.activePipelineJobId);
      if (stored.pendingScript?.scriptId && typeof stored.pendingScript.hook === 'string') setPendingScript(stored.pendingScript);
    } catch {
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(storageKey, JSON.stringify({
      selectedVoiceId,
      pastedTitle,
      pastedText,
      aspectRatio,
      autoRender,
      steps,
      message,
      activeProjectId,
      activePipelineJobId,
      pendingScript
    }));
  }, [hydrated, selectedVoiceId, pastedTitle, pastedText, aspectRatio, autoRender, steps, message, activeProjectId, activePipelineJobId, pendingScript]);

  useEffect(() => {
    if (!hydrated || !activePipelineJobId || pendingScript || activeProjectId) return;
    let cancelled = false;
    let fallbackStarted = false;
    let resolved = false;
    setBusy(true);

    const fallbackToPolling = () => {
      if (fallbackStarted || resolved || cancelled) return;
      fallbackStarted = true;
      void pollPipelineJob(activePipelineJobId).finally(() => {
        if (!cancelled) setBusy(false);
      });
    };

    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      fallbackToPolling();
      return () => {
        cancelled = true;
      };
    }

    const source = new window.EventSource(`/api/pipeline/jobs/${activePipelineJobId}/events`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { job?: PipelineJobView };
        if (!payload.job) return;
        resolved = handlePipelineJobUpdate(payload.job);
        if (resolved) {
          source.close();
          if (!cancelled) setBusy(false);
        }
      } catch {
      }
    };
    source.onerror = () => {
      source.close();
      fallbackToPolling();
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [hydrated, activePipelineJobId, pendingScript, activeProjectId]);

  useEffect(() => {
    if (!pipelineStreamRef.current || !pipelineJob?.streamText) return;
    pipelineStreamRef.current.scrollTop = pipelineStreamRef.current.scrollHeight;
  }, [pipelineJob?.streamText]);

  useEffect(() => {
    const renderStep = steps.find((step) => step.id === 'render');
    if (!activeProjectId || renderStep?.status !== 'running' || busy) return;
    if (backgroundProjectRef.current === activeProjectId) return;
    if (pollingProjectRef.current === activeProjectId) return;
    pollingProjectRef.current = activeProjectId;
    void pollRender(activeProjectId).finally(() => {
      pollingProjectRef.current = null;
    });
  }, [activeProjectId, steps, busy]);

  function updateStep(id: string, patch: Partial<ProgressStep>) {
    setSteps((current) => current.map((step) => step.id === id ? { ...step, ...patch } : step));
  }

  function resetSteps(options?: { preserveBusy?: boolean; clearPersistedState?: boolean }) {
    if (!options?.preserveBusy) {
      setBusy(false);
    }
    setSteps(initialSteps);
    setMessage('');
    setActiveProjectId('');
    setActivePipelineJobId('');
    setPipelineJob(null);
    setPendingScript(null);
    setBackgroundRequested(false);
    pollingProjectRef.current = null;
    pollingPipelineJobRef.current = null;
    backgroundRequestedRef.current = false;
    backgroundProjectRef.current = null;
    stopRequestedRef.current = false;
    if (options?.clearPersistedState !== false && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
      }
    }
  }

  function moveCurrentTaskToBackground() {
    backgroundRequestedRef.current = true;
    setBackgroundRequested(true);
    if (!activeProjectId) {
      setMessage('已收到后台运行请求。当前步骤完成并提交渲染后，会自动转入后台队列。');
      return;
    }

    backgroundProjectRef.current = activeProjectId;
    pollingProjectRef.current = null;
    updateStep('render', { status: 'running', progress: 40, href: `/videos/${activeProjectId}`, detail: '已转入后台队列，可以继续制作下一条视频。' });
    updateStep('review', { status: 'running', progress: 50, href: `/videos/${activeProjectId}`, detail: '后台制作中，打开视频详情查看最新状态。' });
    setBusy(false);
    setDocuments([]);
    setPastedTitle('粘贴文本');
    setPastedText('');
    setMessage('当前视频已转入后台运行。你现在可以开始制作下一条。');
  }

  function addFiles(fileList: FileList | File[]) {
    const nextFiles = Array.from(fileList).filter((file) => /\.(docx|txt|md|html)$/i.test(file.name));
    if (!nextFiles.length) {
      setMessage('请选择 docx / txt / md / html 文件。');
      return;
    }
    setDocuments((current) => [...current, ...nextFiles]);
  }

  async function setDefaultVoice(profileId: string) {
    updateStep('voice', { status: 'running', progress: 40, detail: selectedVoice ? `正在使用 ${selectedVoice.name}` : undefined });
    const response = await fetch(`/api/voices/profiles/${profileId}/default`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '设置默认音色失败');
    updateStep('voice', { status: 'done', progress: 100, detail: `已选择：${payload.profile?.name || selectedVoice?.name || profileId}` });
  }

  async function pollRender(projectId: string) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (stopRequestedRef.current) return;
      if (backgroundProjectRef.current === projectId || backgroundRequestedRef.current) return;
      const response = await fetch(`/api/videos/${projectId}/render-job`, { cache: 'no-store' });
      const payload = await response.json();
      const job = payload.job;
      if (job?.status === 'completed') {
        updateStep('render', { status: 'done', progress: 100, detail: job.outputPath || '成片已生成' });
        updateStep('review', { status: 'done', progress: 100, href: `/videos/${projectId}`, detail: '可以打开视频详情查看输出和制作记录。' });
        return;
      }
      if (job?.status === 'failed') {
        updateStep('render', { status: 'failed', progress: 100, href: `/videos/${projectId}`, detail: compactError(job.error || '制作任务失败，可打开视频详情查看原因并重试。') });
        updateStep('review', { status: 'waiting', progress: 70, href: `/videos/${projectId}`, detail: '项目已保留，可以打开视频详情修改脚本、检查音色或重新渲染。' });
        return;
      }
      if (job?.status === 'cancelled') {
        updateStep('render', { status: 'failed', progress: 100, detail: job.error || '已停止生成' });
        updateStep('review', { status: 'failed', progress: 100, href: `/videos/${projectId}`, detail: '已停止生成，可以打开视频详情重新渲染或删除。' });
        return;
      }
      updateStep('render', {
        status: 'running',
        progress: Math.min(95, 35 + attempt),
        detail: job?.error && job.status === 'queued'
          ? compactError(job.error)
          : job?.status === 'running' ? '正在生成旁白、字幕和成片...' : '任务已提交，等待开始制作...'
      });
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    updateStep('render', { status: 'running', progress: 95, detail: '任务仍在制作中，可以到视频库继续查看。' });
    updateStep('review', { status: 'running', progress: 60, href: `/videos/${projectId}`, detail: '打开视频详情查看最新进度。' });
  }

  async function generateVideo() {
    if (!selectedVoiceId) {
      setMessage('请先从我的素材中选择一个复刻完成的音色。');
      return;
    }
    if (!hasDocumentInput) {
      setMessage('请先拖拽/选择文档，或者粘贴文本。');
      return;
    }

    resetSteps({ preserveBusy: true });
    setBusy(true);
    let keepBusy = false;
    try {
      await setDefaultVoice(selectedVoiceId);
      ensureNotStopped();

      updateStep('import', { status: 'running', progress: 35, detail: documents.length ? `正在上传 ${documents.length} 个文件` : '正在保存粘贴文本' });
      const form = new FormData();
      documents.forEach((file) => form.append('documents', file));
      if (pastedText.trim()) {
        form.append('title', pastedTitle.trim() || '粘贴文本');
        form.append('text', pastedText.trim());
      }
      const importResponse = await fetch('/api/import/upload', { method: 'POST', body: form });
      const importPayload = await readApiJson<{ created?: Array<{ id?: string; tutorialId?: string; title?: string }>; duplicates?: Array<{ id?: string; tutorialId?: string; title?: string }> }>(importResponse, '导入文档失败');
      ensureNotStopped();

      const tutorial = importPayload.created?.[0] || importPayload.duplicates?.[0];
      if (!tutorial?.tutorialId && !tutorial?.id) {
        throw new Error('没有创建或找到可继续处理的文档。');
      }
      const tutorialId = tutorial.id || tutorial.tutorialId;
      updateStep('import', {
        status: 'done',
        progress: 100,
        detail: importPayload.created?.[0] ? `已导入：${tutorial.title}` : `文档已存在，继续使用：${tutorial.title}`,
        href: `/tutorials/${tutorialId}`
      });

      updateStep('parse', { status: 'running', progress: 12, detail: '正在提交脚本生成任务...' });
      const pipelineResponse = await fetch('/api/pipeline/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorialId })
      });
      const pipelinePayload = await readApiJson<{ job?: PipelineJobView }>(pipelineResponse, '生成脚本失败');
      const job = pipelinePayload.job as PipelineJobView | undefined;
      if (!job?.id) throw new Error('脚本任务已创建，但没有返回任务 ID。');
      setActivePipelineJobId(job.id);
      setPipelineJob(job);
      setMessage('脚本生成任务已开始，正在持续同步进度...');
      keepBusy = true;
    } catch (error) {
      const text = formatApiClientError(error, '生成视频失败');
      setMessage(text);
      setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'failed', progress: 100, detail: text } : step));
    } finally {
      if (!keepBusy) setBusy(false);
    }
  }

  async function confirmScriptAndContinue() {
    if (!pendingScript) {
      setMessage('还没有需要确认的脚本。');
      return;
    }

    setBusy(true);
    stopRequestedRef.current = false;
    setBackgroundRequested(false);
    backgroundRequestedRef.current = false;
    backgroundProjectRef.current = null;
    setMessage('已确认脚本，正在创建视频项目和分镜...');

    try {
      const previewWindow = backgroundRequestedRef.current ? null : openPendingWindow();
      updateStep('parse', { status: 'done', progress: 100, detail: '已确认脚本内容。', href: pendingScript.href });
      updateStep('project', { status: 'running', progress: 45, detail: '正在创建视频项目和 storyboard 分镜，通常需要 1-3 分钟。' });
      const createResponse = await fetch('/api/videos/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: pendingScript.scriptId, aspectRatio })
      });
      const createPayload = await readApiJson<{ project?: { id?: string; title?: string }; job?: { status?: string } }>(createResponse, '创建视频项目失败');
      ensureNotStopped();
      const projectId = createPayload.project?.id;
      if (!projectId) throw new Error('视频项目创建成功但没有返回项目 ID。');
      const projectTitle = createPayload.project?.title || pendingScript.title;
      setActiveProjectId(projectId);
      const queuedJobStatus = createPayload.job?.status as string | undefined;
      updateStep('project', {
        status: 'done',
        progress: 100,
        detail: autoRender
          ? `视频项目已创建，渲染任务已${queuedJobStatus === 'running' ? '开始' : '进入队列'}：${projectTitle}`
          : `视频项目已创建：${projectTitle}`,
        href: `/videos/${projectId}`
      });

      if (autoRender) {
        window.dispatchEvent(new CustomEvent('video-render-started', { detail: { projectId } }));
        ensureNotStopped();
        updateStep('render', {
          status: 'running',
          progress: queuedJobStatus === 'running' ? 28 : 16,
          href: `/videos/${projectId}`,
          detail: queuedJobStatus === 'running'
            ? '制作任务已开始，正在持续同步渲染进度...'
            : '制作任务已进入队列，正在等待渲染开始...'
        });
        updateStep('review', { status: 'running', progress: 30, href: `/videos/${projectId}`, detail: '项目已创建，生成完成后可在详情页继续修改。' });
        if (backgroundRequestedRef.current) {
          backgroundProjectRef.current = projectId;
          updateStep('render', { status: 'running', progress: 35, href: `/videos/${projectId}`, detail: '任务已进入后台队列，可以继续开始制作下一条视频。' });
          updateStep('review', { status: 'running', progress: 50, href: `/videos/${projectId}`, detail: '后台制作中，打开视频详情查看最新状态。' });
        } else {
          setPendingScript(null);
          setMessage('视频项目已创建，正在打开真实预览...');
          navigatePendingWindow(previewWindow, `/videos/${projectId}`);
          return;
        }
      } else {
        updateStep('render', { status: 'idle', progress: 0, detail: '已跳过自动制作，可以在视频详情中手动开始。', href: `/videos/${projectId}` });
        updateStep('review', { status: 'running', progress: 50, href: `/videos/${projectId}`, detail: '打开视频详情继续制作或修改。' });
        setPendingScript(null);
        setMessage('视频项目已创建，正在打开真实预览...');
        navigatePendingWindow(previewWindow, `/videos/${projectId}`);
        return;
      }

      setPendingScript(null);
      setMessage('流程已提交，下面可以看到每个环节的状态和可打开的位置。');
      if (backgroundRequestedRef.current) {
        setDocuments([]);
        setPastedTitle('粘贴文本');
        setPastedText('');
        setMessage('当前视频已转入后台运行。你现在可以开始制作下一条。');
      }
    } catch (error) {
      const text = compactError(formatApiClientError(error, '创建视频失败'));
      setMessage(text);
      setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'failed', progress: 100, detail: text } : step));
    } finally {
      setBusy(false);
    }
  }

  async function retryActiveRender() {
    if (!activeProjectId) {
      window.open('/videos', '_blank', 'noopener,noreferrer');
      return;
    }
    setBusy(true);
    setMessage('正在重新提交渲染任务...');
    try {
      updateStep('render', { status: 'running', progress: 25, href: `/videos/${activeProjectId}`, detail: '已重新提交，正在等待制作队列...' });
      updateStep('review', { status: 'running', progress: 35, href: `/videos/${activeProjectId}`, detail: '重新渲染中，完成后可继续修改。' });
      const response = await fetch(`/api/videos/${activeProjectId}/render-retry`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '重新提交渲染失败');
      await pollRender(activeProjectId);
      setMessage('已重新提交渲染。');
    } catch (error) {
      const text = compactError(error);
      updateStep('render', { status: 'failed', progress: 100, href: `/videos/${activeProjectId}`, detail: text });
      updateStep('review', { status: 'waiting', progress: 70, href: `/videos/${activeProjectId}`, detail: '打开视频详情检查失败原因后继续修改。' });
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }

  function ensureNotStopped() {
    if (stopRequestedRef.current) {
      throw new Error('已停止生成');
    }
  }

  async function stopGeneration() {
    stopRequestedRef.current = true;
    setBackgroundRequested(false);
    backgroundRequestedRef.current = false;

    if (!busy) {
      setMessage('当前没有正在生成的任务。');
      return;
    }

    if (activeProjectId) {
      setMessage('正在停止当前生成任务...');
      try {
        const response = await fetch(`/api/videos/${activeProjectId}/render-job/cancel`, { method: 'POST' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '停止生成失败');
        updateStep('render', { status: 'failed', progress: 100, href: `/videos/${activeProjectId}`, detail: '已停止生成。' });
        updateStep('review', { status: 'failed', progress: 100, href: `/videos/${activeProjectId}`, detail: '可以打开视频详情重新渲染或删除。' });
        setMessage('已停止当前视频生成。');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '停止生成失败');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (activePipelineJobId) {
      setMessage('正在停止脚本生成任务...');
      try {
        const response = await fetch(`/api/pipeline/jobs/${activePipelineJobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel' })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '停止脚本生成失败');
        setPipelineJob(payload.job);
        setActivePipelineJobId('');
        updateStep('parse', { status: 'failed', progress: 100, detail: '已停止脚本生成。' });
        setMessage('已停止脚本生成。');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '停止脚本生成失败');
      } finally {
        setBusy(false);
      }
      return;
    }

    setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'failed', progress: 100, detail: '已停止生成' } : step));
    setMessage('已停止当前生成流程。已经完成的文档或脚本会保留在对应页面。');
    setBusy(false);
  }

  async function pollPipelineJob(jobId: string) {
    if (pollingPipelineJobRef.current === jobId) return;
    pollingPipelineJobRef.current = jobId;
    try {
      for (let attempt = 0; attempt < 900; attempt += 1) {
        const response = await fetch(`/api/pipeline/jobs/${jobId}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 404) {
            setActivePipelineJobId('');
            setPipelineJob(null);
            updateStep('parse', { status: 'failed', progress: 100, detail: '上一次脚本任务已不存在，请重新开始。' });
            setMessage('检测到旧的脚本任务状态已经失效，当前页已自动清理。');
            return;
          }
          throw new Error(payload.error || '读取脚本生成进度失败');
        }
        const job = payload.job as PipelineJobView;
        if (handlePipelineJobUpdate(job)) return;

        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      setMessage('脚本生成仍在进行中，页面会继续保留当前进度。');
    } finally {
      if (pollingPipelineJobRef.current === jobId) {
        pollingPipelineJobRef.current = null;
      }
    }
  }

  function handlePipelineJobUpdate(job: PipelineJobView) {
    setPipelineJob(job);
    syncPipelineStep(job);

    if (job.status === 'completed') {
      const firstScriptId = job.result?.firstScriptId;
      const firstScriptTitle = job.result?.firstScriptTitle;
      const firstScriptHook = job.result?.scripts?.find((item) => item.id === firstScriptId)?.hook || job.previewText || '';
      if (!firstScriptId || !firstScriptTitle) {
        const text = '脚本任务已完成，但没有返回可用脚本。';
        setActivePipelineJobId('');
        updateStep('parse', { status: 'failed', progress: 100, detail: text });
        setMessage(text);
        return true;
      }
      setPendingScript({
        scriptId: firstScriptId,
        title: firstScriptTitle,
        href: `/scripts/${firstScriptId}`,
        hook: firstScriptHook
      });
      setActivePipelineJobId('');
      updateStep('parse', { status: 'waiting', progress: 100, detail: '脚本已生成，请先确认脚本内容。', href: `/scripts/${firstScriptId}` });
      updateStep('project', { status: 'waiting', progress: 0, detail: '确认脚本后，会进入 OpenAI 整片 storyboard 生成。' });
      updateStep('render', { status: 'idle', progress: 0, detail: '创建视频项目后再进入成片生成。' });
      updateStep('review', { status: 'idle', progress: 0, detail: '创建视频项目后再进入结果检查。' });
      setMessage('脚本已生成。当前页不再展示本地自动拆镜草稿；确认后会直接创建真实视频项目并打开预览。');
      return true;
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      setActivePipelineJobId('');
      const text = compactError(job.error || job.detail || (job.status === 'cancelled' ? '已停止脚本生成' : '脚本生成失败'));
      updateStep('parse', { status: 'failed', progress: 100, detail: text });
      setMessage(text);
      return true;
    }

    return false;
  }

  function syncPipelineStep(job: PipelineJobView) {
    const status = job.status === 'queued' ? 'waiting' : job.status === 'failed' || job.status === 'cancelled' ? 'failed' : job.status === 'completed' ? 'done' : 'running';
    const prefix = job.totalTopics === 1
      ? '主脚本'
      : job.currentTopicIndex && job.totalTopics
        ? `第 ${job.currentTopicIndex}/${job.totalTopics} 个脚本`
        : job.totalTopics
          ? `共 ${job.totalTopics} 个脚本`
          : undefined;
    const detailParts = [
      prefix,
      job.currentTopicTitle ? `当前选题：${job.currentTopicTitle}` : undefined,
      job.detail
    ].filter(Boolean);

    updateStep('parse', {
      status,
      progress: job.progress,
      detail: detailParts.join(' · ') || '正在生成脚本...',
      href: job.result?.firstScriptId ? `/scripts/${job.result.firstScriptId}` : undefined
    });
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.15fr 0.85fr', gap: 16, alignItems: 'stretch' }}>
        <StepCard refProp={voiceSectionRef} step="1" title="选择旁白音色" badge={<StatusBadge text={selectedVoice ? '已选择' : '未选择'} tone={selectedVoice ? 'success' : 'warning'} />}>
          <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.7 }}>从我的素材中选择一个复刻完成的声音。上传和复刻新声音请到“我的素材”。</p>
          {readyVoices.length ? (
            <select value={selectedVoiceId} onChange={(event) => setSelectedVoiceId(event.target.value)} style={inputStyle}>
              {readyVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {providerLabel(voice.provider)}</option>)}
            </select>
          ) : (
            <div style={{ ...subtlePanelStyle, padding: 12, color: '#fbbf24', lineHeight: 1.6 }}>还没有复刻完成的音色。</div>
          )}
          {selectedVoice ? <div style={{ ...subtlePanelStyle, padding: 12, display: 'grid', gap: 6 }}><strong>{selectedVoice.name}</strong><span style={{ color: '#94a3b8' }}>服务：{providerLabel(selectedVoice.provider)}</span></div> : null}
          <Link href="/assets" {...newWindowLinkProps} style={linkButtonStyle('secondary')}>去我的素材管理音色</Link>
        </StepCard>

        <StepCard refProp={documentSectionRef} step="2" title="上传文档或粘贴文本">
          <div
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => { event.preventDefault(); setDragActive(false); addFiles(event.dataTransfer.files); }}
            style={{ borderRadius: 12, border: `1px dashed ${dragActive ? '#38bdf8' : '#475569'}`, background: dragActive ? '#082f49' : '#0f141d', minHeight: 126, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 16 }}
          >
            <div style={{ display: 'grid', gap: 8 }}>
              <strong>拖拽文档到这里</strong>
              <span style={{ color: '#94a3b8' }}>支持 docx / txt / md / html</span>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => fileInputRef.current?.click()} style={secondaryButtonStyle}>选择文件</button>
                <button type="button" onClick={() => folderInputRef.current?.click()} style={secondaryButtonStyle}>选择文件夹</button>
              </div>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept=".docx,.txt,.md,.html" multiple onChange={(event) => event.target.files && addFiles(event.target.files)} style={{ display: 'none' }} />
          <input ref={folderInputRef} type="file" multiple onChange={(event) => event.target.files && addFiles(event.target.files)} style={{ display: 'none' }} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
          {documents.length ? <div style={{ ...subtlePanelStyle, padding: 10, display: 'grid', gap: 5 }}>{documents.slice(0, 4).map((file) => <span key={`${file.name}-${file.size}`} style={{ color: '#cbd5e1', fontSize: 13 }}>{file.name}</span>)}{documents.length > 4 ? <span style={{ color: '#94a3b8', fontSize: 13 }}>还有 {documents.length - 4} 个文件</span> : null}<button type="button" onClick={() => setDocuments([])} style={{ ...secondaryButtonStyle, width: 'fit-content' }}>清空文件</button></div> : null}
          <input value={pastedTitle} onChange={(event) => setPastedTitle(event.target.value)} placeholder="粘贴文本标题" style={inputStyle} />
          <textarea value={pastedText} onChange={(event) => setPastedText(event.target.value)} placeholder="也可以直接把文档内容复制粘贴到这里..." style={{ ...inputStyle, minHeight: 96, resize: 'vertical', lineHeight: 1.6 }} />
        </StepCard>

        <StepCard refProp={generateSectionRef} step="3" title="生成脚本与视频" badge={<StatusBadge text="智能讲解模板" tone="info" />}>
          <div style={{ ...subtlePanelStyle, padding: 12, display: 'grid', gap: 8 }}>
            <strong>画面比例</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button type="button" onClick={() => setAspectRatio('9:16')} style={ratioButtonStyle(aspectRatio === '9:16')}>竖屏 9:16</button>
              <button type="button" onClick={() => setAspectRatio('16:9')} style={ratioButtonStyle(aspectRatio === '16:9')}>横屏 16:9</button>
            </div>
            <span style={{ color: '#94a3b8', lineHeight: 1.6 }}>智能讲解模板，适合教程、产品介绍、培训资料和方法论文档。</span>
          </div>
          <label style={checkStyle}>
            <input type="checkbox" checked={autoRender} onChange={(event) => setAutoRender(event.target.checked)} />
            创建后自动生成成片
          </label>
          <div style={{ ...subtlePanelStyle, padding: 12, display: 'grid', gap: 8 }}>
            <strong>预计时长</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <EstimateMini label="成片" value={hasDocumentInput ? estimate.estimatedVideoDuration : '待添加文档'} />
              <EstimateMini label="生成耗时" value={hasDocumentInput ? estimate.estimatedGenerationRange : '待添加文档'} />
            </div>
            <span style={{ color: '#94a3b8', lineHeight: 1.6 }}>估算会根据文本长度、文件大小、镜头数量和当前并发设置自动变化。</span>
          </div>
          <button type="button" onClick={generateVideo} disabled={!canGenerate} style={{ ...primaryButtonStyle, width: '100%' }}>{busy ? '正在生成...' : '开始解析并生成脚本'}</button>
          <button
            type="button"
            onClick={stopGeneration}
            disabled={!busy}
            style={{
              ...secondaryButtonStyle,
              width: '100%',
              borderColor: busy ? '#854d0e' : '#334155',
              color: busy ? '#fde68a' : '#64748b',
              cursor: busy ? 'pointer' : 'not-allowed',
              opacity: busy ? 1 : 0.72
            }}
          >
            停止生成
          </button>
          <button
            type="button"
            onClick={moveCurrentTaskToBackground}
            disabled={!busy || !autoRender || backgroundRequested}
            style={{
              ...secondaryButtonStyle,
              width: '100%',
              borderColor: busy && autoRender ? '#38bdf8' : '#334155',
              color: busy && autoRender ? '#e0f2fe' : '#64748b',
              cursor: busy && autoRender && !backgroundRequested ? 'pointer' : 'not-allowed'
            }}
          >
            {backgroundRequested ? '已转入后台，可开始下一条' : busy && autoRender ? '转入后台，开始下一条' : '转入后台，开始下一条'}
          </button>
          <span style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>{busy && autoRender ? '当前任务会继续制作，首页会释放出来。' : '开始生成后，这个按钮会变为可用。'}</span>
          <span style={{ color: canGenerate ? '#86efac' : '#fbbf24', fontSize: 13, lineHeight: 1.5 }}>{canGenerate ? '已准备好开始制作。' : '请先选择音色并添加文档。'}</span>
        </StepCard>
      </section>

      {message ? <div style={{ borderRadius: 10, border: '1px solid #334155', background: '#111823', color: '#dbeafe', padding: 14, lineHeight: 1.7 }}>{message}</div> : null}

      {pipelineJob && activePipelineJobId ? (
        <section style={{ borderRadius: 12, border: '1px solid #155e75', background: '#071923', padding: 18, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <strong style={{ color: '#67e8f9' }}>脚本生成实时状态</strong>
              <span style={{ color: '#cbd5e1', lineHeight: 1.6 }}>
                {formatPipelineStage(pipelineJob.stage)}
                {pipelineJob.totalTopics === 1 ? ' · 主脚本' : pipelineJob.currentTopicIndex && pipelineJob.totalTopics ? ` · 第 ${pipelineJob.currentTopicIndex}/${pipelineJob.totalTopics} 个脚本` : ''}
                {pipelineJob.currentTopicTitle ? ` · ${pipelineJob.currentTopicTitle}` : ''}
              </span>
            </div>
            <StatusBadge text={pipelineJob.status === 'queued' ? '排队中' : pipelineJob.status === 'running' ? '生成中' : pipelineJob.status === 'completed' ? '已完成' : pipelineJob.status === 'cancelled' ? '已停止' : '失败'} tone={pipelineJob.status === 'completed' ? 'success' : pipelineJob.status === 'failed' || pipelineJob.status === 'cancelled' ? 'danger' : pipelineJob.status === 'queued' ? 'warning' : 'info'} />
          </div>
          <ProgressBar value={pipelineJob.progress} />
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ color: '#94a3b8', lineHeight: 1.6 }}>
              等待时长：{formatElapsedMs(pipelineJob.elapsedMs)}
                {pipelineJob.attempt && pipelineJob.maxAttempts ? ` · OpenAI 尝试 ${pipelineJob.attempt}/${pipelineJob.maxAttempts}` : ''}
            </span>
            <span style={{ color: '#dbeafe', lineHeight: 1.7 }}>{pipelineJob.detail || '正在等待最新状态...'}</span>
            <span style={{ color: '#67e8f9', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              实时摘要：{pipelineJob.previewText || '模型还没有返回文本，当前主要是在等待本轮 OpenAI 响应。'}
            </span>
            <div style={{ borderRadius: 10, border: '1px solid #164e63', background: '#08131d', padding: 12, display: 'grid', gap: 8 }}>
              <strong style={{ color: '#a5f3fc' }}>OpenAI 流式回传</strong>
              <div
                ref={pipelineStreamRef}
                style={{
                  maxHeight: 260,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  color: '#dbeafe',
                  lineHeight: 1.7,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace'
                }}
              >
                {pipelineJob.streamText || pipelineJob.previewText || '模型尚未开始返回正文，当前先显示进度心跳。'}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {pendingScript ? (
        <section style={{ borderRadius: 12, border: '1px solid #854d0e', background: '#17130a', padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0, fontSize: 21 }}>确认脚本</h2>
              <p style={{ margin: 0, color: '#fcd34d', lineHeight: 1.7 }}>{autoRender ? '确认后会创建真实视频项目，并自动提交成片生成任务。' : '确认后只创建视频项目和模板预览；进入详情页后需要手动点击“开始生成成片”。'}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href={pendingScript.href} {...newWindowLinkProps} style={linkButtonStyle('secondary')}>打开脚本详情</Link>
              <button type="button" onClick={confirmScriptAndContinue} disabled={busy} style={{ ...primaryButtonStyle, minWidth: 210 }}>
                {busy ? '继续中...' : autoRender ? '确认脚本并开始生成' : '确认脚本并创建项目'}
              </button>
            </div>
          </div>
          <div style={{ borderRadius: 10, border: '1px solid #3f3215', background: '#111823', padding: 14, display: 'grid', gap: 10 }}>
            <strong style={{ color: '#f8fafc', lineHeight: 1.45 }}>{pendingScript.title}</strong>
            <span style={{ color: '#cbd5e1', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{pendingScript.hook || '脚本已生成，建议打开脚本详情查看完整正文后继续。'}</span>
            <span style={{ color: '#7dd3fc', lineHeight: 1.6 }}>下一步不是本地拆镜确认，而是真实创建视频项目，再由 OpenAI 整片规划 storyboard。</span>
          </div>
        </section>
      ) : null}

      <section style={{ borderRadius: 12, border: '1px solid #263244', background: '#151b26', padding: 18, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 21 }}>生产进度</h2>
            <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.7 }}>
              每一步都会显示状态；预计成片 {hasDocumentInput ? estimate.estimatedVideoDuration : '待计算'}，预计{busy ? '剩余' : '生成'} {hasDocumentInput ? remainingEstimate : '待计算'}。
            </p>
          </div>
          <div style={{ minWidth: 220, display: 'grid', gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#cbd5e1', fontSize: 13 }}><span>总进度</span><strong>{totalProgress}%</strong></div>
            <ProgressBar value={totalProgress} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={stopGeneration}
              disabled={!busy}
              style={{
                ...secondaryButtonStyle,
                borderColor: busy ? '#854d0e' : '#334155',
                color: busy ? '#fde68a' : '#64748b',
                cursor: busy ? 'pointer' : 'not-allowed',
                opacity: busy ? 1 : 0.72
              }}
            >
              停止当前任务
            </button>
            <button type="button" onClick={() => resetSteps()} style={secondaryButtonStyle}>重置状态</button>
          </div>
        </div>
        {hasDocumentInput ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
            {estimate.steps.map((item) => <EstimateMini key={item.id} label={item.title} value={item.range} />)}
          </div>
        ) : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {steps.map((step, index) => (
            <div key={step.id} style={{ borderRadius: 10, border: '1px solid #243042', background: '#111823', padding: 13, display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 12, alignItems: 'center' }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: '#0f172a', color: '#7dd3fc', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{index + 1}</div>
              <div style={{ display: 'grid', gap: 5 }}>
                <strong>{step.title}</strong>
                <span style={{ color: '#94a3b8', lineHeight: 1.5 }}>{step.detail || step.desc}</span>
                <ProgressBar value={step.progress} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {step.href ? <Link href={step.href} {...newWindowLinkProps} style={linkButtonStyle('secondary')}>打开</Link> : <button type="button" onClick={() => handleStepAction(step.id)} style={secondaryButtonStyle}>{step.id === 'voice' ? '选音色' : step.id === 'import' ? '加文档' : step.id === 'render' || step.id === 'review' ? '看视频库' : '查看'}</button>}
                {(step.id === 'render' || step.id === 'review') && step.status === 'failed' && activeProjectId ? <button type="button" onClick={retryActiveRender} disabled={busy} style={secondaryButtonStyle}>重试</button> : null}
                <StatusBadge text={statusText(step.status)} tone={statusTone(step.status)} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  function handleStepAction(id: string) {
    if (id === 'voice') {
      voiceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (id === 'import' || id === 'parse') {
      documentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (id === 'project') {
      generateSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    window.open(activeProjectId ? `/videos/${activeProjectId}` : '/videos', '_blank', 'noopener,noreferrer');
  }
}

function EstimateMini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: 10, border: '1px solid #243042', background: '#0f141d', padding: 10, display: 'grid', gap: 5, minWidth: 0 }}>
      <span style={{ color: '#7f8da3', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <strong style={{ color: '#dbeafe', fontSize: 13, lineHeight: 1.4 }}>{value}</strong>
    </div>
  );
}

function StepCard({ refProp, step, title, badge, children }: { refProp?: React.RefObject<HTMLElement>; step: string; title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section ref={refProp} style={{ borderRadius: 12, border: '1px solid #263244', background: '#151b26', padding: 18, display: 'grid', gap: 14, alignContent: 'start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: '#082f49', color: '#7dd3fc', fontWeight: 800 }}>{step}</span>
          <h2 style={{ margin: 0, fontSize: 19 }}>{title}</h2>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div style={{ height: 7, borderRadius: 999, background: '#0f172a', overflow: 'hidden', border: '1px solid #243042' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', borderRadius: 999, background: value >= 100 ? '#34d399' : '#38bdf8', transition: 'width 260ms ease' }} />
    </div>
  );
}

function formatElapsedMs(value?: number) {
  if (!value || value < 1000) return '不足 1 秒';
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${totalSeconds} 秒`;
  return `${minutes} 分 ${seconds} 秒`;
}

function formatPipelineStage(stage: string) {
  const labels: Record<string, string> = {
    queued: '任务排队中',
    starting: '开始处理',
    cancelling: '正在停止',
    cancelled: '已停止',
    loading: '读取数据',
    'parsing-tutorial': '解析文档',
    'generating-topics': '提炼选题',
    'topics-ready': '选题完成',
    'generating-script': '正在生成脚本',
    'requesting-model': '等待 OpenAI',
    'validating-result': '校验脚本结构',
    completed: '已完成',
    failed: '处理失败',
    'saving-results': '写入结果',
    'script-ready': '脚本完成'
  };
  return labels[stage] || stage;
}

function ratioButtonStyle(active: boolean) {
  return {
    border: active ? '1px solid #38bdf8' : '1px solid #334155',
    borderRadius: 10,
    background: active ? '#082f49' : '#0f141d',
    color: active ? '#7dd3fc' : '#cbd5e1',
    padding: '10px 12px',
    fontWeight: 800,
    cursor: 'pointer'
  } as const;
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #334155',
  borderRadius: 10,
  background: '#0f141d',
  color: '#f8fafc',
  padding: '11px 12px',
  outline: 'none'
} as const;

const checkStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  color: '#cbd5e1',
  fontSize: 13,
  lineHeight: 1.5
} as const;
