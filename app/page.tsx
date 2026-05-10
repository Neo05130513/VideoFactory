export const dynamic = 'force-dynamic';

import nextDynamic from 'next/dynamic';
import Link from 'next/link';
import { StudioShell } from './_components/studio-shell';
import { linkButtonStyle, newWindowLinkProps, Panel, SectionTitle, StatusBadge, subtlePanelStyle } from './_components/studio-ui';
import { getDashboardViewModel } from './_view-models/dashboard';
import { getCurrentUser } from '@/lib/auth';
import { getPerformanceSettings } from '@/lib/performance/settings';
import { listVoiceProfiles } from '@/lib/voice-profiles';

const StartMakingClient = nextDynamic(
  () => import('./start-making-client').then((mod) => mod.StartMakingClient),
  {
    ssr: false,
    loading: () => (
      <Panel style={{ display: 'grid', gap: 12 }}>
        <SectionTitle title="开始制作" note="正在加载交互面板..." />
        <div style={{ ...subtlePanelStyle, padding: 16, color: '#94a3b8', lineHeight: 1.7 }}>
          页面正在初始化，完成后才能选择比例、粘贴文案并开始生成。
        </div>
      </Panel>
    )
  }
);

export default async function StartPage() {
  const [user, dashboard, performance] = await Promise.all([
    getCurrentUser(),
    getDashboardViewModel(),
    getPerformanceSettings()
  ]);
  const voiceProfiles = user
    ? (await listVoiceProfiles()).filter((profile) => profile.userId === user.id)
    : [];
  const readyVoices = voiceProfiles.filter((item) => item.status === 'ready');
  const pendingScripts = dashboard.scriptsWithoutProjects.length;
  const pendingVideos = dashboard.projectsPendingRender.length;
  const blockedVideos = dashboard.failedProjects.length;

  return (
    <StudioShell
      active="start"
      title="用你的声音生成讲解视频"
      subtitle="先从我的素材选择音色，再上传文档或粘贴文本，系统会自动生成横屏或竖屏讲解视频。"
    >
      <StartMakingClient initialProfiles={voiceProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        status: profile.status,
        isDefault: profile.isDefault,
        lastError: profile.lastError
      }))} performanceSettings={performance.settings} />

      <Panel style={{ display: 'grid', gap: 16 }}>
        <SectionTitle title="制作前检查" note="这里显示真正会影响下一条视频能不能顺利生成的事项。" />
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
          <ActionTile
            title="旁白音色"
            value={readyVoices.length ? `${readyVoices.length} 个可用` : '未准备'}
            note={readyVoices[0]?.name || '先到我的素材上传并复刻声音'}
            tone={readyVoices.length ? 'success' : 'warning'}
            href="/assets"
            action={readyVoices.length ? '管理音色' : '去复刻音色'}
          />
          <ActionTile
            title="设备并发"
            value={`${performance.settings.totalTaskConcurrency} 条流程`}
            note={`渲染并发 ${performance.settings.renderConcurrency}，低内存阈值 ${performance.settings.lowMemoryThresholdGb}GB`}
            tone="info"
            href="/settings"
            action="调整性能"
          />
          <ActionTile
            title="待确认脚本"
            value={`${pendingScripts} 条`}
            note={dashboard.firstScriptWithoutProject?.title || '暂无等待确认的脚本'}
            tone={pendingScripts ? 'warning' : 'neutral'}
            href="/scripts"
            action={pendingScripts ? '确认脚本' : '查看脚本'}
          />
          <ActionTile
            title="视频处理"
            value={blockedVideos ? `${blockedVideos} 个阻塞` : `${pendingVideos} 个待生成`}
            note={blockedVideos ? '先处理失败或已停止的视频' : pendingVideos ? '有项目等待渲染或重试' : '当前没有卡住的视频项目'}
            tone={blockedVideos ? 'danger' : pendingVideos ? 'warning' : 'success'}
            href="/videos"
            action="打开视频库"
          />
        </section>
      </Panel>
    </StudioShell>
  );
}

function ActionTile({
  title,
  value,
  note,
  tone,
  href,
  action
}: {
  title: string;
  value: string;
  note: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  href: string;
  action: string;
}) {
  return (
    <div style={{ ...subtlePanelStyle, padding: 15, display: 'grid', gap: 10, alignContent: 'start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <span style={{ color: '#8ea0b8', fontSize: 13 }}>{title}</span>
        <StatusBadge text={statusLabel(tone)} tone={tone} />
      </div>
      <strong style={{ color: toneColor(tone), fontSize: 22, lineHeight: 1.2 }}>{value}</strong>
      <span style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.55, minHeight: 40, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{note}</span>
      <Link href={href} {...newWindowLinkProps} style={{ ...linkButtonStyle('secondary'), width: 'fit-content' }}>{action}</Link>
    </div>
  );
}

function statusLabel(tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger') {
  if (tone === 'success') return '正常';
  if (tone === 'warning') return '待处理';
  if (tone === 'danger') return '阻塞';
  if (tone === 'info') return '可调整';
  return '可查看';
}

function toneColor(tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger') {
  if (tone === 'success') return '#34d399';
  if (tone === 'warning') return '#fbbf24';
  if (tone === 'danger') return '#f87171';
  if (tone === 'info') return '#38bdf8';
  return '#cbd5e1';
}
