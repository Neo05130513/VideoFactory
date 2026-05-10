'use client';

import { useState } from 'react';
import { navigatePendingWindow, openPendingWindow } from '../../_components/open-new-window';
import type { PipelineJob } from '@/lib/types';

export function TutorialActions({ tutorialId, hasTopics, hasScripts }: { tutorialId: string; hasTopics: boolean; hasScripts: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [processJob, setProcessJob] = useState<Pick<PipelineJob, 'id' | 'status' | 'stage' | 'progress' | 'detail' | 'previewText' | 'currentTopicIndex' | 'totalTopics' | 'currentTopicTitle' | 'error'> | null>(null);

  async function run(action: 'parse' | 'process') {
    const nextWindow = openPendingWindow();
    const key = action;
    setBusy(key);
    if (action === 'process') setProcessJob(null);
    setMessage(action === 'parse' ? '正在解析教程...' : '正在执行完整流程...');
    try {
      if (action === 'parse') {
        const response = await fetch(`/api/tutorials/${tutorialId}/parse`, {
          method: 'POST'
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || '操作失败');
        }
        setMessage('教程解析完成，已在新窗口打开最新详情。');
        navigatePendingWindow(nextWindow, `/tutorials/${tutorialId}`);
      } else {
        const response = await fetch('/api/pipeline/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tutorialId })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || '操作失败');
        }
        const job = payload.job as PipelineJob | undefined;
        if (!job?.id) {
          throw new Error('处理任务已创建，但没有返回任务 ID。');
        }
        setProcessJob(job);
        await pollProcessJob(job.id, nextWindow);
        return;
      }
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(null);
    }
  }

  async function pollProcessJob(jobId: string, nextWindow: Window | null) {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const response = await fetch(`/api/pipeline/jobs/${jobId}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '读取处理进度失败');
      }
      const job = payload.job as PipelineJob;
      setProcessJob(job);
      setMessage(job.detail || '正在执行完整流程...');

      if (job.status === 'completed') {
        setMessage('教程全流程处理完成，已在新窗口打开脚本工作台。');
        navigatePendingWindow(nextWindow, '/scripts');
        return;
      }

      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new Error(job.error || job.detail || (job.status === 'cancelled' ? '已停止教程处理' : '教程处理失败'));
      }

      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => run('parse')} disabled={busy !== null} style={buttonStyle(busy === 'parse')}>{busy === 'parse' ? '解析中...' : '重新解析教程'}</button>
        <button onClick={() => run('process')} disabled={busy !== null} style={primaryButtonStyle(busy === 'process')}>{busy === 'process' ? '处理中...' : hasScripts ? '重新跑完整流程' : '一键生成选题和脚本'}</button>
        {busy === 'process' && processJob?.id ? <button onClick={() => void stopProcess()} style={buttonStyle(false)}>停止完整流程</button> : null}
      </div>
      <div style={{ color: '#cbd5e1', lineHeight: 1.7 }}>
        当前状态：{hasScripts ? '已经有脚本，可直接继续推进视频。' : hasTopics ? '已有选题，适合继续补齐脚本。' : '还没有选题和脚本，建议先跑完整流程。'}
      </div>
      {processJob && busy === 'process' ? (
        <div style={{ borderRadius: 14, border: '1px solid rgba(34,211,238,0.28)', background: 'rgba(8,47,73,0.38)', padding: 14, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ color: '#67e8f9' }}>完整流程实时状态</strong>
            <span style={{ color: '#cbd5e1' }}>{processJob.progress}%</span>
          </div>
          <div style={{ height: 7, borderRadius: 999, background: '#0f172a', overflow: 'hidden', border: '1px solid rgba(51,65,85,0.8)' }}>
            <div style={{ width: `${Math.max(0, Math.min(100, processJob.progress))}%`, height: '100%', borderRadius: 999, background: '#22d3ee', transition: 'width 260ms ease' }} />
          </div>
          <div style={{ color: '#cbd5e1', lineHeight: 1.7 }}>
            {formatProcessStage(processJob.stage)}
            {processJob.totalTopics === 1 ? ' · 主脚本' : processJob.currentTopicIndex && processJob.totalTopics ? ` · 第 ${processJob.currentTopicIndex}/${processJob.totalTopics} 个脚本` : ''}
            {processJob.currentTopicTitle ? ` · ${processJob.currentTopicTitle}` : ''}
          </div>
          <div style={{ color: '#dbeafe', lineHeight: 1.7 }}>{processJob.detail || '正在等待最新状态...'}</div>
          <div style={{ color: '#67e8f9', lineHeight: 1.7 }}>实时文字预览：{processJob.previewText || '模型还没有返回文本，当前主要是在等待 OpenAI 响应。'}</div>
        </div>
      ) : null}
      {message ? <div style={{ color: '#93c5fd', lineHeight: 1.7 }}>{message}</div> : null}
    </div>
  );

  async function stopProcess() {
    if (!processJob?.id) return;
    setMessage('正在停止完整流程...');
    try {
      const response = await fetch(`/api/pipeline/jobs/${processJob.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '停止完整流程失败');
      setProcessJob(payload.job);
      setMessage('已停止完整流程。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '停止完整流程失败');
    } finally {
      setBusy(null);
    }
  }
}

function formatProcessStage(stage: string) {
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
    'script-ready': '脚本完成',
    'saving-results': '写入结果',
    completed: '已完成',
    failed: '处理失败'
  };
  return labels[stage] || stage;
}

function buttonStyle(isBusy: boolean) {
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
