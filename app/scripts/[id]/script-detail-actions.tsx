'use client';

import Link from 'next/link';
import { useState } from 'react';
import { navigatePendingWindow, openPendingWindow } from '../../_components/open-new-window';
import { linkButtonStyle, newWindowLinkProps, primaryButtonStyle, secondaryButtonStyle } from '../../_components/studio-ui';

type AspectRatio = '9:16' | '16:9';
type ProjectTemplate = 'ai-explainer-short-v1' | 'hyperframes-explainer-v1' | 'tech-explainer-v1' | 'tutorial-demo-v1';

const templateOptions: Array<{ value: ProjectTemplate; label: string; note: string }> = [
  { value: 'ai-explainer-short-v1', label: 'AI 科普短视频', note: '新版 Remotion 模板，适合讲解、方法论和产品介绍。' },
  { value: 'hyperframes-explainer-v1', label: 'Hyperframes 视觉实验', note: 'HTML 卡片、浏览器框和动态图层，适合高质感短视频。' },
  { value: 'tech-explainer-v1', label: '技术解释器', note: '偏信息图和流程拆解，适合技术内容。' },
  { value: 'tutorial-demo-v1', label: '教程演示', note: '早期演示模板，适合简单教程验证。' }
];

export function ScriptDetailActions({ scriptId, projectIds }: { scriptId: string; projectIds: string[] }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [template, setTemplate] = useState<ProjectTemplate>('ai-explainer-short-v1');

  async function createProject() {
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
      if (!response.ok) throw new Error(payload.error || '创建视频失败');
      navigatePendingWindow(nextWindow, `/videos/${payload.project.id}`);
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '创建视频失败');
    } finally {
      setBusy('');
    }
  }

  async function duplicateScript() {
    const nextWindow = openPendingWindow();
    setBusy('duplicate');
    setMessage('正在复制脚本...');
    try {
      const response = await fetch('/api/scripts/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '复制脚本失败');
      navigatePendingWindow(nextWindow, `/scripts/${payload.script.id}`);
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '复制脚本失败');
    } finally {
      setBusy('');
    }
  }

  async function rebuildProject(projectId: string) {
    const nextWindow = openPendingWindow();
    setBusy(`rebuild:${projectId}`);
    setMessage('正在按当前脚本重建视频...');
    try {
      const response = await fetch(`/api/videos/${projectId}/rebuild-from-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '重建视频失败');
      navigatePendingWindow(nextWindow, `/videos/${payload.project.id}`);
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '重建视频失败');
    } finally {
      setBusy('');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gap: 10, border: '1px solid #263244', background: '#111823', borderRadius: 10, padding: 12 }}>
        <strong style={{ color: '#e5ecf7' }}>画面比例</strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button type="button" onClick={() => setAspectRatio('9:16')} style={optionButtonStyle(aspectRatio === '9:16')}>竖屏 9:16</button>
          <button type="button" onClick={() => setAspectRatio('16:9')} style={optionButtonStyle(aspectRatio === '16:9')}>横屏 16:9</button>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10, border: '1px solid #263244', background: '#111823', borderRadius: 10, padding: 12 }}>
        <strong style={{ color: '#e5ecf7' }}>视频模板</strong>
        {templateOptions.map((option) => (
          <button key={option.value} type="button" onClick={() => setTemplate(option.value)} style={templateButtonStyle(template === option.value)}>
            <span style={{ fontWeight: 850 }}>{option.label}</span>
            <span style={{ color: template === option.value ? '#0f172a' : '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>{option.note}</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={createProject} disabled={Boolean(busy)} style={primaryButtonStyle}>
        {busy === 'create' ? '创建中...' : '用当前脚本生成视频'}
      </button>
      <button type="button" onClick={duplicateScript} disabled={Boolean(busy)} style={secondaryButtonStyle}>
        {busy === 'duplicate' ? '复制中...' : '复制一份再修改'}
      </button>
      {projectIds.slice(0, 3).map((projectId) => (
        <button key={projectId} type="button" onClick={() => rebuildProject(projectId)} disabled={Boolean(busy)} style={secondaryButtonStyle}>
          {busy === `rebuild:${projectId}` ? '重建中...' : `更新已有视频 ${projectId.slice(-4)}`}
        </button>
      ))}
      <Link href={`/api/scripts/${scriptId}/export`} {...newWindowLinkProps} style={linkButtonStyle('secondary')}>导出 TXT</Link>
      {message ? <div style={{ color: '#93c5fd', lineHeight: 1.6 }}>{message}</div> : null}
    </div>
  );
}

function optionButtonStyle(active: boolean) {
  return {
    border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
    borderRadius: 10,
    background: active ? '#38bdf8' : '#162031',
    color: active ? '#061018' : '#dbeafe',
    padding: '10px 12px',
    fontWeight: 850,
    cursor: 'pointer'
  } as const;
}

function templateButtonStyle(active: boolean) {
  return {
    border: `1px solid ${active ? '#2dd4bf' : '#334155'}`,
    borderRadius: 10,
    background: active ? '#2dd4bf' : '#162031',
    color: active ? '#0f172a' : '#e5ecf7',
    padding: 12,
    cursor: 'pointer',
    textAlign: 'left',
    display: 'grid',
    gap: 5
  } as const;
}
