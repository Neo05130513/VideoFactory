'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatApiClientError, readApiJson } from '../_components/api-client';
import { EmptyGuide, Panel, SectionTitle, StatusBadge, subtlePanelStyle } from '../_components/studio-ui';
import type { Script, Tutorial, VideoProject } from '@/lib/types';

type Props = {
  initialScripts: Script[];
  tutorials: Tutorial[];
  projects: VideoProject[];
};

export function ScriptsPageClient({ initialScripts, tutorials, projects }: Props) {
  const [scripts, setScripts] = useState(initialScripts);
  const [projectList, setProjectList] = useState(projects);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const pendingScripts = useMemo(() => scripts.filter((script) => !projectList.some((project) => project.scriptId === script.id)), [projectList, scripts]);
  const latestScripts = useMemo(
    () => [...scripts].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt))).slice(0, 80),
    [scripts]
  );
  const pendingIdSet = useMemo(() => new Set(pendingScripts.map((script) => script.id)), [pendingScripts]);
  const selectedPendingIds = selectedIds.filter((id) => pendingIdSet.has(id));
  const allPendingSelected = pendingScripts.length > 0 && selectedPendingIds.length === pendingScripts.length;

  function toggleSelected(scriptId: string) {
    setSelectedIds((current) => current.includes(scriptId) ? current.filter((id) => id !== scriptId) : [...current, scriptId]);
  }

  function toggleAllPending() {
    setSelectedIds((current) => {
      const currentSet = new Set(current);
      if (allPendingSelected) return current.filter((id) => !pendingIdSet.has(id));
      pendingScripts.forEach((script) => currentSet.add(script.id));
      return Array.from(currentSet);
    });
  }

  async function deleteOne(scriptId: string, title: string) {
    if (!window.confirm(`确定删除脚本《${title}》吗？删除后无法恢复。`)) return;
    setBusyKey(`delete:${scriptId}`);
    setMessage('正在删除脚本...');
    try {
      const response = await fetch(`/api/scripts/${scriptId}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '删除脚本失败');
      setScripts((current) => current.filter((item) => item.id !== scriptId));
      setSelectedIds((current) => current.filter((id) => id !== scriptId));
      setMessage(`已删除脚本：${title}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除脚本失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function createVideoProject(scriptId: string, title: string) {
    setBusyKey(`create:${scriptId}`);
    setMessage(`已确认脚本《${title}》，正在创建视频项目并提交生成...`);
    try {
      const response = await fetch('/api/videos/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptId,
          aspectRatio: '9:16',
          template: 'ai-explainer-short-v1'
        })
      });
      const payload = await readApiJson<{ project: VideoProject }>(response, '创建视频项目失败');
      setProjectList((current) => [payload.project, ...current.filter((item) => item.id !== payload.project.id)]);
      setSelectedIds((current) => current.filter((id) => id !== scriptId));
      setMessage(`视频项目已创建：${payload.project.title}。正在打开视频详情...`);
      window.location.href = `/videos/${payload.project.id}`;
    } catch (error) {
      setMessage(formatApiClientError(error, '创建视频项目失败'));
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteSelected() {
    if (!selectedPendingIds.length) {
      setMessage('请先勾选至少一条待生成脚本。');
      return;
    }
    if (!window.confirm(`确定批量删除 ${selectedPendingIds.length} 条待生成脚本吗？删除后无法恢复。`)) return;
    setBusyKey('batch-delete');
    setMessage('正在批量删除脚本...');
    try {
      const response = await fetch('/api/scripts/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptIds: selectedPendingIds })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '批量删除脚本失败');
      const deletedIdSet = new Set<string>((payload.deleted || []).map((item: { id: string }) => item.id));
      setScripts((current) => current.filter((item) => !deletedIdSet.has(item.id)));
      setSelectedIds((current) => current.filter((id) => !deletedIdSet.has(id)));
      setMessage(`已批量删除 ${payload.count || deletedIdSet.size} 条脚本。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量删除脚本失败');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel style={{ display: 'grid', gap: 16 }}>
        <SectionTitle title="待生成脚本" note="这里可以直接清理不用推进的视频脚本。支持勾选、多选和批量删除。" />
        {pendingScripts.length ? (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={toggleAllPending} disabled={busyKey !== null} style={toolbarButtonStyle(false)}>
                  {allPendingSelected ? '取消全选待生成' : '全选待生成'}
                </button>
                <button onClick={() => setSelectedIds((current) => current.filter((id) => !pendingIdSet.has(id)))} disabled={busyKey !== null || !selectedPendingIds.length} style={toolbarButtonStyle(false)}>
                  清空选择
                </button>
                <button onClick={deleteSelected} disabled={busyKey !== null || !selectedPendingIds.length} style={toolbarButtonStyle(true)}>
                  {busyKey === 'batch-delete' ? '删除中...' : `批量删除 (${selectedPendingIds.length})`}
                </button>
              </div>
              <span style={{ color: '#94a3b8', lineHeight: 1.6 }}>共 {pendingScripts.length} 条待生成脚本，当前选中 {selectedPendingIds.length} 条。</span>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {pendingScripts.map((script) => {
                const tutorial = tutorials.find((item) => item.id === script.tutorialId);
                const deleting = busyKey === `delete:${script.id}`;
                return (
                  <div key={script.id} style={{ ...subtlePanelStyle, padding: 14, display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr) auto', gap: 14, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(script.id)}
                      onChange={() => toggleSelected(script.id)}
                      disabled={busyKey !== null}
                      style={{ width: 18, height: 18 }}
                    />
                    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                      <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{script.title}</strong>
                      <span style={{ color: '#94a3b8', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tutorial?.title || '未知文档'} · {script.duration} · v{script.version || 1}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <StatusBadge text="待生成" tone="warning" />
                      <button onClick={() => void createVideoProject(script.id, script.title)} disabled={busyKey !== null} style={createButtonStyle(busyKey === `create:${script.id}`)}>
                        {busyKey === `create:${script.id}` ? '生成中...' : '生成视频'}
                      </button>
                      <Link href={`/scripts/${script.id}`} style={linkStyle('#7dd3fc')}>打开</Link>
                      <button onClick={() => void deleteOne(script.id, script.title)} disabled={busyKey !== null} style={dangerButtonStyle(deleting)}>
                        {deleting ? '删除中...' : '删除'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyGuide title="没有待生成脚本" text="当前待生成脚本已经清空，新的脚本会在这里集中处理。" />
        )}
      </Panel>

      <Panel style={{ display: 'grid', gap: 16 }}>
        <SectionTitle title="脚本列表" note="全部脚本仍然保留在这里。已有视频的脚本不会出现在上面的删除区里。" />
        {latestScripts.length ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {latestScripts.map((script) => {
              const tutorial = tutorials.find((item) => item.id === script.tutorialId);
              const relatedProjects = projectList.filter((project) => project.scriptId === script.id);
              return (
                <Link
                  key={script.id}
                  href={`/scripts/${script.id}`}
                  style={{ ...subtlePanelStyle, padding: 14, color: 'inherit', textDecoration: 'none', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 14, alignItems: 'center' }}
                >
                  <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                    <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{script.title}</strong>
                    <span style={{ color: '#94a3b8', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tutorial?.title || '未知文档'} · {script.duration} · v{script.version || 1}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <StatusBadge text={relatedProjects.length ? '已有视频' : '待生成'} tone={relatedProjects.length ? 'success' : 'warning'} />
                    <span style={{ color: '#7dd3fc', fontWeight: 800 }}>打开</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyGuide title="还没有脚本" text="先在开始制作页导入文档，系统会自动理解文档并撰写脚本。" href="/" action="开始制作" />
        )}
      </Panel>

      {message ? <div style={{ color: '#93c5fd', lineHeight: 1.7 }}>{message}</div> : null}
    </div>
  );
}

function createButtonStyle(isBusy: boolean) {
  return {
    border: '1px solid rgba(45,212,191,0.36)',
    borderRadius: 12,
    padding: '9px 12px',
    background: isBusy ? 'rgba(20,184,166,0.2)' : '#2dd4bf',
    color: isBusy ? '#99f6e4' : '#0f172a',
    fontWeight: 850,
    cursor: isBusy ? 'progress' : 'pointer'
  } as const;
}

function toolbarButtonStyle(danger: boolean) {
  return {
    border: `1px solid ${danger ? 'rgba(248,113,113,0.28)' : 'rgba(148,163,184,0.24)'}`,
    borderRadius: 12,
    padding: '10px 14px',
    background: danger ? 'rgba(127,29,29,0.24)' : 'rgba(255,255,255,0.04)',
    color: danger ? '#fecaca' : '#e5ecf7',
    fontWeight: 800,
    cursor: 'pointer'
  } as const;
}

function dangerButtonStyle(isBusy: boolean) {
  return {
    border: '1px solid rgba(248,113,113,0.32)',
    borderRadius: 12,
    padding: '9px 12px',
    background: isBusy ? 'rgba(127,29,29,0.28)' : 'rgba(127,29,29,0.18)',
    color: '#fecaca',
    fontWeight: 800,
    cursor: isBusy ? 'progress' : 'pointer'
  } as const;
}

function linkStyle(color: string) {
  return {
    textDecoration: 'none',
    color,
    fontWeight: 800,
    padding: '10px 0'
  } as const;
}
