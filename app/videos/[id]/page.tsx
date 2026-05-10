export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StudioShell } from '../../_components/studio-shell';
import { EmptyGuide, linkButtonStyle, MetricTile, newWindowLinkProps, Panel, SectionTitle, StatusBadge, subtlePanelStyle } from '../../_components/studio-ui';
import { getRenderJobs, getScripts, getTutorials, getVideoAssets, getVideoProjects, getVideoScenes } from '@/lib/queries';
import { sanitizeSceneText } from '@/lib/narration';
import { buildSubtitleCues } from '@/lib/subtitles';
import { getVideoProgressSnapshot } from '@/lib/video-progress';
import type { RemotionVideoInput } from '@/remotion/types';
import { VideoProjectActions } from './project-actions';
import { RemotionProjectPreview } from '../_components/remotion-project-preview';
import { VideoProgressPanel } from '../video-progress-panel';

export default async function VideoProjectDetailPage({ params }: { params: { id: string } }) {
  const [projects, scenes, assets, scripts, tutorials, jobs] = await Promise.all([
    getVideoProjects(),
    getVideoScenes(),
    getVideoAssets(),
    getScripts(),
    getTutorials(),
    getRenderJobs().catch(() => [])
  ]);

  const project = projects.find((item) => item.id === params.id);
  if (!project) notFound();

  const script = scripts.find((item) => item.id === project.scriptId);
  const tutorial = tutorials.find((item) => item.id === project.tutorialId);
  const projectScenes = scenes
    .filter((item) => item.projectId === project.id)
    .sort((a, b) => a.order - b.order)
    .map((scene) => sanitizeSceneText(scene));
  const projectAssets = assets.filter((item) => item.projectId === project.id);
  const videoAsset = projectAssets.find((asset) => asset.assetType === 'video' && asset.status === 'ready');
  const audioBySceneId = new Map(projectAssets.filter((asset) => asset.assetType === 'audio' && asset.status === 'ready').map((asset) => [asset.sceneId, asset.path]));
  const previewInput: RemotionVideoInput = {
    project: {
      id: project.id,
      title: project.title,
      template: project.template,
      aspectRatio: project.aspectRatio,
      visualPreset: project.visualPreset
    },
    scenes: projectScenes.map((scene) => ({
      id: scene.id,
      order: scene.order,
      shotType: scene.shotType,
      visualType: scene.visualType,
      visualPrompt: scene.visualPrompt,
      voiceover: scene.voiceover,
      subtitle: scene.subtitle,
      durationSec: scene.durationSec,
      audioPath: audioBySceneId.get(scene.id),
      layout: scene.layout,
      headline: scene.headline,
      emphasis: scene.emphasis,
      keywords: scene.keywords,
      cards: scene.cards,
      chartData: scene.chartData,
      transition: scene.transition,
      subtitleCues: buildSubtitleCues(scene.voiceover, scene.durationSec)
    }))
  };
  const audioCount = projectAssets.filter((asset) => asset.assetType === 'audio').length;
  const imageCount = projectAssets.filter((asset) => asset.assetType === 'image').length;
  const subtitleCount = projectAssets.filter((asset) => asset.assetType === 'subtitle').length;
  const latestJob = [...jobs]
    .filter((job) => job.projectId === project.id)
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))[0] || null;
  const status = formatStatus(project.status, latestJob?.status);
  const progressSnapshot = getVideoProgressSnapshot({
    project,
    job: latestJob,
    scenes: projectScenes,
    assets: projectAssets
  });

  return (
    <StudioShell
      active="videos"
      title="视频详情"
      subtitle="只展示继续制作和检查结果需要的信息。更细的资产日志、审计和质检记录先收起来。"
      action={<Link href="/videos" {...newWindowLinkProps} style={linkButtonStyle('secondary')}>回到视频库</Link>}
    >
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
        <MetricTile label="当前状态" value={status.text} note={latestJob?.status ? `任务：${formatJobStatus(latestJob.status)}` : '暂无任务'} tone={status.toneColor} />
        <MetricTile label="画面比例" value={project.aspectRatio} note="生成视频尺寸" />
        <MetricTile label="镜头数量" value={`${projectScenes.length}`} note="分镜片段" tone="#38bdf8" />
        <MetricTile label="输出文件" value={videoAsset ? '已生成' : '暂无'} note={videoAsset ? '可预览下载' : '等待渲染'} tone={videoAsset ? '#34d399' : '#fbbf24'} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16, alignItems: 'start' }}>
        <Panel style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
            <SectionTitle title={project.title} note={script ? `脚本：${script.title}` : '没有找到关联脚本'} />
            <StatusBadge text={status.text} tone={status.tone} />
          </div>

          {project.lastError ? (
            <div style={{ borderRadius: 18, border: '1px solid #7f1d1d', background: '#3b1116', color: '#fecaca', padding: 14, lineHeight: 1.7 }}>
              {project.lastError}
            </div>
          ) : null}

          <section style={{ display: 'grid', gap: 12, borderRadius: 18, border: '1px solid rgba(56,189,248,0.22)', background: 'rgba(14, 165, 233, 0.07)', padding: 14 }}>
            <SectionTitle title="生成状态" note={progressSnapshot.canStop ? '任务正在执行，可以停止或等待完成。' : progressSnapshot.progress >= 100 ? '当前项目已有最终成片。' : '分镜已生成后，需要点击按钮才会开始输出 MP4。'} />
            <VideoProgressPanel projectId={project.id} initial={progressSnapshot} />
          </section>

          <VideoProjectActions
            projectId={project.id}
            projectTitle={project.title}
            projectStatus={project.status}
            hasOutput={Boolean(videoAsset)}
            initialJobStatus={latestJob?.status || ''}
          />

          <section style={{ display: 'grid', gap: 12 }}>
            <SectionTitle title="模板预览" note="不用等待最终 MP4，也可以先检查画面节奏、字幕和模板风格。" />
            {projectScenes.length ? (
              <RemotionProjectPreview input={previewInput} />
            ) : (
              <EmptyGuide title="还不能预览" text="生成分镜后，这里会显示 Remotion 模板预览。" />
            )}
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <AssetTile label="图片" value={imageCount} />
            <AssetTile label="旁白" value={audioCount} />
            <AssetTile label="字幕" value={subtitleCount} />
          </div>

          <section style={{ display: 'grid', gap: 12 }}>
            <SectionTitle title="输出" note="有成片后可以直接打开预览或下载。" />
            {videoAsset ? (
              <a href={videoAsset.path} target="_blank" rel="noreferrer" style={linkButtonStyle('primary')}>打开成片</a>
            ) : (
              <EmptyGuide title="还没有成片" text="点击上方“开始生成成片”，任务进入队列后这里会显示最新进度。" />
            )}
          </section>

          <section style={{ display: 'grid', gap: 12 }}>
            <SectionTitle title="镜头概要" note="这里只看每个镜头的标题和时长，避免信息过载。" />
            {projectScenes.length ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {projectScenes.slice(0, 12).map((scene) => (
                  <div key={scene.id} style={{ ...subtlePanelStyle, borderRadius: 20, padding: 13, display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) auto', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 12, background: '#0f172a', color: '#7dd3fc', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{scene.order}</div>
                    <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
                      <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scene.headline || scene.subtitle || `镜头 ${scene.order}`}</strong>
                      <span style={{ color: '#94a3b8', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scene.subtitle || scene.visualPrompt}</span>
                    </div>
                    <span style={{ color: '#cbd5e1', fontSize: 13 }}>{scene.durationSec}s</span>
                  </div>
                ))}
                {projectScenes.length > 12 ? <span style={{ color: '#94a3b8' }}>还有 {projectScenes.length - 12} 个镜头未展开。</span> : null}
              </div>
            ) : (
              <EmptyGuide title="还没有分镜" text="点击重新生成分镜后，这里会显示镜头概要。" />
            )}
          </section>
        </Panel>

        <aside style={{ display: 'grid', gap: 14 }}>
          <Panel style={{ display: 'grid', gap: 12 }}>
            <SectionTitle title="项目信息" />
            <InfoRow label="来源文档" value={tutorial?.title || '未知'} />
            <InfoRow label="创建时间" value={formatDate(project.createdAt)} />
            <InfoRow label="更新时间" value={formatDate(project.updatedAt)} />
            <InfoRow label="模板" value={formatTemplate(project.template)} />
          </Panel>

          <Panel style={{ display: 'grid', gap: 12 }}>
            <SectionTitle title="继续修改" />
            {script ? <Link href={`/scripts/${script.id}`} {...newWindowLinkProps} style={linkButtonStyle('secondary')}>打开脚本</Link> : null}
            {tutorial ? <Link href={`/tutorials/${tutorial.id}`} {...newWindowLinkProps} style={linkButtonStyle('secondary')}>查看文档</Link> : null}
            <Link href="/assets" {...newWindowLinkProps} style={linkButtonStyle('secondary')}>打开素材库</Link>
          </Panel>

          <Panel style={{ display: 'grid', gap: 12 }}>
            <SectionTitle title="最近任务" />
            {latestJob ? (
              <>
                <InfoRow label="任务状态" value={formatJobStatus(latestJob.status)} />
                <InfoRow label="更新时间" value={formatDate(latestJob.updatedAt)} />
                {latestJob.error ? <div style={{ color: '#fecaca', lineHeight: 1.7 }}>{latestJob.error}</div> : null}
              </>
            ) : (
              <EmptyGuide title="没有渲染任务" text="点击重新渲染项目后，这里会显示任务状态。" />
            )}
          </Panel>
        </aside>
      </section>
    </StudioShell>
  );
}

function AssetTile({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ ...subtlePanelStyle, padding: 13, display: 'grid', gap: 6 }}>
      <span style={{ color: '#94a3b8', fontSize: 12 }}>{label}</span>
      <strong style={{ color: value ? '#34d399' : '#94a3b8', fontSize: 22 }}>{value}</strong>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      <span style={{ color: '#7f8da3', fontSize: 12 }}>{label}</span>
      <strong style={{ color: '#cbd5e1', lineHeight: 1.5, wordBreak: 'break-word' }}>{value}</strong>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatJobStatus(status: string) {
  const labels: Record<string, string> = {
    queued: '排队中',
    running: '制作中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已停止'
  };
  return labels[status] || status;
}

function formatTemplate(template: string) {
  const labels: Record<string, string> = {
    'ai-explainer-short-v1': 'AI 科普短视频',
    'hyperframes-explainer-v1': 'Hyperframes 视觉实验',
    'tech-explainer-v1': '技术解释器',
    'tutorial-demo-v1': '教程演示'
  };
  return labels[template] || template;
}

function formatStatus(status: string, jobStatus?: string) {
  if (jobStatus === 'queued') return { text: '排队中', tone: 'info' as const, toneColor: '#38bdf8' };
  if (jobStatus === 'running') return { text: '制作中', tone: 'info' as const, toneColor: '#38bdf8' };
  if (jobStatus === 'cancelled') return { text: '已停止', tone: 'danger' as const, toneColor: '#fbbf24' };
  if (jobStatus === 'failed') return { text: '失败', tone: 'danger' as const, toneColor: '#f87171' };
  if (status === 'completed') return { text: '已完成', tone: 'success' as const, toneColor: '#34d399' };
  if (status === 'failed') return { text: '需要处理', tone: 'danger' as const, toneColor: '#f87171' };
  if (status === 'rendering') return { text: '制作中', tone: 'info' as const, toneColor: '#38bdf8' };
  if (status === 'storyboarded') return { text: '未开始生成', tone: 'warning' as const, toneColor: '#fbbf24' };
  return { text: '未开始生成', tone: 'neutral' as const, toneColor: '#94a3b8' };
}
