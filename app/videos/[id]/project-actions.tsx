'use client';

import { useEffect, useState } from 'react';
import { navigatePendingWindow, openPendingWindow } from '../../_components/open-new-window';

type VideoProjectActionsProps = {
  projectId: string;
  projectTitle: string;
  projectStatus: string;
  hasOutput: boolean;
  initialJobStatus?: string;
};

export function VideoProjectActions({ projectId, projectTitle, projectStatus, hasOutput, initialJobStatus = '' }: VideoProjectActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [jobStatus, setJobStatus] = useState<string>(initialJobStatus);
  const [pendingRenderWindow, setPendingRenderWindow] = useState<Window | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const response = await fetch(`/api/videos/${projectId}/render-job`, { cache: 'no-store' });
        const payload = await response.json();
        const job = payload.job as { status?: string; stage?: string; progress?: number; error?: string; outputPath?: string } | null;
        if (cancelled) return;
        if (!job?.status) {
          if (jobStatus === 'queued' || jobStatus === 'running') timer = setTimeout(poll, 2500);
          return;
        }
        setJobStatus(job.status);
        if (job.status === 'queued') setMessage(job.error || '生成任务已进入队列，等待执行...');
        if (job.status === 'running') setMessage(job.error || `生成中：${job.stage || '正在输出成片'}${typeof job.progress === 'number' ? `（${job.progress}%）` : ''}`);
        if (job.status === 'completed') setMessage(`项目《${projectTitle}》渲染完成，已在新窗口打开最新详情。`);
        if (job.status === 'failed') setMessage(job.error || '渲染任务失败');
        if (job.status === 'cancelled') setMessage(job.error || '已停止生成。');
        if (job.status === 'queued' || job.status === 'running') {
          timer = setTimeout(poll, 2500);
        } else if (job.status === 'completed' && !cancelled && pendingRenderWindow) {
          navigatePendingWindow(pendingRenderWindow, `/videos/${projectId}`);
          setPendingRenderWindow(null);
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 4000);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobStatus, pendingRenderWindow, projectId, projectTitle]);

  useEffect(() => {
    setJobStatus(initialJobStatus);
  }, [initialJobStatus, projectId]);

  const isActiveJob = jobStatus === 'queued' || jobStatus === 'running';
  const primaryLabel = busy === 'render'
    ? '提交中...'
    : jobStatus === 'queued'
      ? '排队中...'
      : jobStatus === 'running'
        ? '生成中...'
        : hasOutput
          ? '重新生成成片'
          : projectStatus === 'storyboarded' || projectStatus === 'draft'
            ? '开始生成成片'
            : '生成成片';
  const actionHint = isActiveJob
    ? '任务已经提交，下面会持续显示队列和渲染进度。'
    : hasOutput
      ? '已有成片；如修改了脚本或分镜，可以重新生成。'
      : '当前还没有执行生成，点击“开始生成成片”才会进入队列。';

  async function regenerateStoryboard() {
    const nextWindow = openPendingWindow();
    setBusy('storyboard');
    setMessage('正在重新生成分镜...');
    try {
      const response = await fetch(`/api/videos/${projectId}/storyboard`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '重新生成分镜失败');
      }
      setMessage(`项目《${projectTitle}》分镜已更新，已在新窗口打开最新详情。`);
      navigatePendingWindow(nextWindow, `/videos/${projectId}`);
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '重新生成分镜失败');
    } finally {
      setBusy(null);
    }
  }

  async function renderProject() {
    const nextWindow = openPendingWindow();
    setBusy('render');
    setMessage('正在提交渲染任务...');
    try {
      const response = await fetch(`/api/videos/${projectId}/render`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '提交渲染任务失败');
      }
      setJobStatus(payload.job?.status || 'queued');
      setPendingRenderWindow(nextWindow);
      window.dispatchEvent(new CustomEvent('video-render-started', { detail: { projectId } }));
      setMessage('生成任务已创建，系统会异步执行。状态会在这里持续更新。');
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '渲染视频失败');
    } finally {
      setBusy(null);
    }
  }

  async function stopProject() {
    setBusy('stop');
    setMessage('正在停止生成...');
    try {
      const response = await fetch(`/api/videos/${projectId}/render-job/cancel`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '停止生成失败');
      }
      setJobStatus('cancelled');
      setPendingRenderWindow(null);
      setMessage('已停止生成。后续可以重新渲染项目。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '停止生成失败');
    } finally {
      setBusy(null);
    }
  }

  async function deleteProject() {
    if (!window.confirm('确定删除这个视频项目吗？相关分镜、素材记录和任务记录会一起删除。')) return;
    setBusy('delete');
    setMessage('正在删除视频项目...');
    try {
      const response = await fetch(`/api/videos/${projectId}`, {
        method: 'DELETE'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '删除视频失败');
      }
      window.location.href = '/videos';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除视频失败');
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={regenerateStoryboard} disabled={busy !== null} style={secondaryButtonStyle(busy === 'storyboard')}>
          {busy === 'storyboard' ? '生成中...' : '重新生成分镜'}
        </button>
        <button onClick={renderProject} disabled={busy !== null || isActiveJob} style={primaryButtonStyle(busy === 'render' || isActiveJob)}>
          {primaryLabel}
        </button>
        {isActiveJob ? (
          <button onClick={stopProject} disabled={busy !== null} style={dangerButtonStyle(busy === 'stop', 'warning')}>
            {busy === 'stop' ? '停止中...' : '停止生成'}
          </button>
        ) : null}
        <button onClick={deleteProject} disabled={busy !== null} style={dangerButtonStyle(busy === 'delete', 'danger')}>
          {busy === 'delete' ? '删除中...' : '删除视频'}
        </button>
      </div>
      <div style={{ color: '#94a3b8', lineHeight: 1.7 }}>{actionHint}</div>
      {message ? <div style={{ color: '#93c5fd', lineHeight: 1.7 }}>{message}</div> : null}
    </div>
  );
}

function primaryButtonStyle(isBusy: boolean) {
  return {
    border: 'none',
    borderRadius: 14,
    padding: '12px 16px',
    background: isBusy ? '#0f766e' : 'linear-gradient(135deg, #67e8f9, #14b8a6)',
    color: '#061018',
    fontWeight: 800,
    cursor: isBusy ? 'progress' : 'pointer'
  } as const;
}

function secondaryButtonStyle(isBusy: boolean) {
  return {
    border: '1px solid rgba(148,163,184,0.24)',
    borderRadius: 14,
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e5ecf7',
    fontWeight: 700,
    cursor: isBusy ? 'progress' : 'pointer'
  } as const;
}

function dangerButtonStyle(isBusy: boolean, tone: 'warning' | 'danger') {
  return {
    border: `1px solid ${tone === 'warning' ? '#854d0e' : '#7f1d1d'}`,
    borderRadius: 14,
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.04)',
    color: tone === 'warning' ? '#fde68a' : '#fecaca',
    fontWeight: 800,
    cursor: isBusy ? 'progress' : 'pointer'
  } as const;
}
