'use client';

import { useState } from 'react';
import { navigatePendingWindow, openPendingWindow } from '../_components/open-new-window';

type AspectRatio = '9:16' | '16:9';
type ProjectTemplate = 'ai-explainer-short-v1' | 'hyperframes-explainer-v1' | 'tech-explainer-v1' | 'tutorial-demo-v1';

export function ScriptActions({ scriptId, tutorialId, hasProject, projectIds = [] }: { scriptId: string; tutorialId: string; hasProject: boolean; projectIds?: string[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [template, setTemplate] = useState<ProjectTemplate>('ai-explainer-short-v1');

  async function createVideoProject() {
    const nextWindow = openPendingWindow();
    setBusy('create');
    setMessage('已确认当前脚本，正在创建视频项目...');
    try {
      const response = await fetch('/api/videos/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId, aspectRatio, template })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '创建视频项目失败');
      }
      setMessage('视频项目创建完成，已在新窗口打开。');
      navigatePendingWindow(nextWindow, `/videos/${payload.project.id}`);
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '创建视频项目失败');
    } finally {
      setBusy(null);
    }
  }

  async function duplicateScript() {
    const nextWindow = openPendingWindow();
    setBusy('duplicate');
    setMessage('正在复制脚本版本...');
    try {
      const response = await fetch('/api/scripts/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '复制脚本失败');
      }
      setMessage('脚本版本复制成功，已在新窗口打开。');
      navigatePendingWindow(nextWindow, `/scripts/${payload.script.id}`);
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '复制脚本失败');
    } finally {
      setBusy(null);
    }
  }

  async function rebuildProjectFromScript(projectId: string) {
    const nextWindow = openPendingWindow();
    setBusy(`rebuild:${projectId}`);
    setMessage('正在按当前脚本版本重建项目分镜...');
    try {
      const response = await fetch(`/api/videos/${projectId}/rebuild-from-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '按脚本重建项目失败');
      }
      setMessage('项目已按当前脚本版本重建分镜，已在新窗口打开。');
      navigatePendingWindow(nextWindow, `/videos/${payload.project.id}`);
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '按脚本重建项目失败');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <button onClick={() => setAspectRatio('9:16')} style={optionButtonStyle(aspectRatio === '9:16')}>竖屏 9:16</button>
        <button onClick={() => setAspectRatio('16:9')} style={optionButtonStyle(aspectRatio === '16:9')}>横屏 16:9</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        <button onClick={() => setTemplate('ai-explainer-short-v1')} style={optionButtonStyle(template === 'ai-explainer-short-v1')}>AI 科普</button>
        <button onClick={() => setTemplate('hyperframes-explainer-v1')} style={optionButtonStyle(template === 'hyperframes-explainer-v1')}>Hyperframes</button>
        <button onClick={() => setTemplate('tech-explainer-v1')} style={optionButtonStyle(template === 'tech-explainer-v1')}>技术解释</button>
        <button onClick={() => setTemplate('tutorial-demo-v1')} style={optionButtonStyle(template === 'tutorial-demo-v1')}>教程演示</button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={createVideoProject} disabled={busy !== null} style={primaryButtonStyle(busy === 'create')}>
          {busy === 'create' ? '创建中...' : hasProject ? '用当前脚本再创建一个视频项目' : '用当前脚本创建视频项目'}
        </button>
        <button onClick={duplicateScript} disabled={busy !== null} style={secondaryButtonStyle(busy === 'duplicate')}>
          {busy === 'duplicate' ? '复制中...' : '复制为新版本'}
        </button>
        <a href={`/api/scripts/${scriptId}/export`} target="_blank" rel="noreferrer" style={linkStyle('#fbbf24')}>导出脚本 TXT ↓</a>
        <a href={`/scripts/${scriptId}`} target="_blank" rel="noreferrer" style={linkStyle('#c4b5fd')}>打开脚本详情 →</a>
        <a href={`/tutorials/${tutorialId}`} target="_blank" rel="noreferrer" style={linkStyle('#93c5fd')}>查看教程详情 →</a>
        <a href="/videos" target="_blank" rel="noreferrer" style={linkStyle('#67e8f9')}>去视频工厂 →</a>
      </div>
      {projectIds.length ? <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{projectIds.slice(0, 3).map((projectId) => <button key={projectId} onClick={() => rebuildProjectFromScript(projectId)} disabled={busy !== null} style={secondaryButtonStyle(busy === `rebuild:${projectId}`)}>{busy === `rebuild:${projectId}` ? '重建中...' : `按当前版本重建项目 ${projectId.slice(-4)}`}</button>)}</div> : null}
      {message ? <div style={{ color: '#93c5fd', lineHeight: 1.7 }}>{message}</div> : null}
    </div>
  );
}

function optionButtonStyle(active: boolean) {
  return {
    border: `1px solid ${active ? '#38bdf8' : 'rgba(148,163,184,0.24)'}`,
    borderRadius: 12,
    padding: '10px 12px',
    background: active ? '#38bdf8' : 'rgba(255,255,255,0.04)',
    color: active ? '#0f172a' : '#e5ecf7',
    fontWeight: 800,
    cursor: 'pointer'
  } as const;
}

function primaryButtonStyle(isBusy: boolean) {
  return {
    border: 'none',
    borderRadius: 14,
    padding: '10px 14px',
    background: isBusy ? '#0891b2' : 'linear-gradient(135deg, #67e8f9, #06b6d4)',
    color: '#0f172a',
    fontWeight: 800,
    cursor: isBusy ? 'progress' : 'pointer'
  } as const;
}

function secondaryButtonStyle(isBusy: boolean) {
  return {
    border: '1px solid rgba(148,163,184,0.24)',
    borderRadius: 14,
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e5ecf7',
    fontWeight: 700,
    cursor: isBusy ? 'progress' : 'pointer'
  } as const;
}

function linkStyle(color: string) {
  return {
    textDecoration: 'none',
    color,
    fontWeight: 700,
    padding: '10px 0'
  } as const;
}
