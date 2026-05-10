export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { StudioShell } from '../_components/studio-shell';
import { EmptyGuide, linkButtonStyle, MetricTile, newWindowLinkProps, Panel, SectionTitle, StatusBadge, subtlePanelStyle } from '../_components/studio-ui';
import { getCurrentUser } from '@/lib/auth';
import { getPerformanceSettings } from '@/lib/performance/settings';
import { getVideoRuntimeStatus } from '@/lib/queries';
import { listVoiceProfiles } from '@/lib/voice-profiles';
import { getSafeVoiceSettings } from '@/lib/voice-settings';
import { PerformanceSettingsClient } from './performance-settings-client';

export default async function SettingsPage() {
  const [user, runtime, voiceSettings, performance] = await Promise.all([
    getCurrentUser(),
    getVideoRuntimeStatus(),
    getSafeVoiceSettings(),
    getPerformanceSettings()
  ]);
  const voices = user ? (await listVoiceProfiles()).filter((profile) => profile.userId === user.id) : [];
  const defaultVoice = voices.find((profile) => profile.isDefault) || voices.find((profile) => profile.status === 'ready');

  return (
    <StudioShell
      active="settings"
      title="设置"
      subtitle="普通用户只需要确认语音服务、默认声音和存储位置；模型与接口参数放在高级信息里。"
      action={<Link href="/probe" {...newWindowLinkProps} style={linkButtonStyle('secondary')}>打开诊断详情</Link>}
    >
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
        <MetricTile label="语音服务" value={voiceSettings.provider === 'aliyun-cosyvoice' ? 'CosyVoice' : voiceSettings.provider === 'minimax' ? 'MiniMax' : '自定义'} note={voiceServiceReady(voiceSettings) ? '已配置' : '需配置'} tone={voiceServiceReady(voiceSettings) ? '#34d399' : '#fbbf24'} />
        <MetricTile label="默认声音" value={defaultVoice?.name || '未设置'} note={defaultVoice?.status === 'ready' ? '可用于正式视频' : '建议先复刻声音'} tone={defaultVoice?.status === 'ready' ? '#34d399' : '#fbbf24'} />
        <MetricTile label="视频渲染" value={runtime.remotionDependenciesInstalled ? '可用' : '不可用'} note="Remotion 主链路" tone={runtime.remotionDependenciesInstalled ? '#34d399' : '#f87171'} />
        <MetricTile label="数据目录" value={runtime.dataDirectoryWritable ? '可写' : '不可写'} note="Mac/Windows 运行关键项" tone={runtime.dataDirectoryWritable ? '#34d399' : '#f87171'} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Panel style={{ display: 'grid', gap: 16 }}>
          <SectionTitle title="服务状态" note="这些能力决定脚本、storyboard、图片、旁白和视频合成能不能跑通。" />
          <div style={{ display: 'grid', gap: 10 }}>
            <SettingRow label="OpenAI" value={runtime.openaiConfigured ? '已配置' : '未配置'} ok={runtime.openaiConfigured} />
            <SettingRow label="语音供应商" value={formatProvider(voiceSettings.provider)} ok={voiceServiceReady(voiceSettings)} />
            <SettingRow label="MiniMax" value={runtime.minimaxConfigured ? '已配置' : '未配置'} ok={runtime.minimaxConfigured} />
            <SettingRow label="Remotion" value={runtime.remotionDependenciesInstalled ? '可解析' : '不可解析'} ok={runtime.remotionDependenciesInstalled} />
            <SettingRow label="ffmpeg" value={runtime.ffmpegInstalled ? '可用' : '未安装'} ok={runtime.ffmpegInstalled} />
          </div>
        </Panel>

        <Panel style={{ display: 'grid', gap: 16 }}>
          <SectionTitle title="默认旁白" note="正式视频建议使用你复刻完成的声音；系统默认声音只适合测试流程。" />
          {defaultVoice ? (
            <div style={{ ...subtlePanelStyle, padding: 14, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <strong>{defaultVoice.name}</strong>
                <StatusBadge text={defaultVoice.status === 'ready' ? '可用' : defaultVoice.status === 'failed' ? '失败' : '处理中'} tone={defaultVoice.status === 'ready' ? 'success' : defaultVoice.status === 'failed' ? 'danger' : 'warning'} />
              </div>
              <span style={{ color: '#94a3b8' }}>服务：{formatProvider(defaultVoice.provider)}</span>
              {defaultVoice.lastError ? <span style={{ color: '#fecaca', lineHeight: 1.6 }}>{defaultVoice.lastError}</span> : null}
            </div>
          ) : (
            <EmptyGuide title="还没有默认声音" text="先到开始制作页上传声音样本，复刻完成后会自动作为默认旁白。" href="/" action="上传声音" />
          )}
          <Link href="/assets" {...newWindowLinkProps} style={linkButtonStyle('secondary')}>管理我的声音</Link>
        </Panel>
      </section>

      <Panel style={{ display: 'grid', gap: 16 }}>
        <SectionTitle title="性能与后台任务" note="系统会根据 CPU、内存和显卡给出推荐并发。普通设备建议保持渲染并发为 1，避免电脑卡顿。" />
        <PerformanceSettingsClient initialDevice={performance.device} initialSettings={performance.settings} recommended={performance.recommended} />
      </Panel>

      <Panel style={{ display: 'grid', gap: 16 }}>
        <SectionTitle title="存储位置" note="桌面版运行时，数据目录必须指向用户可写位置，避免写入应用安装目录。" />
        <div style={{ display: 'grid', gap: 10 }}>
          <PathRow label="应用目录" value={runtime.appRoot} />
          <PathRow label="数据目录" value={runtime.dataRoot} />
          <PathRow label="导入归档" value={runtime.importsRoot} />
          <PathRow label="生成目录" value={runtime.generatedRoot} />
        </div>
      </Panel>

      <Panel style={{ display: 'grid', gap: 16 }}>
        <SectionTitle title="高级信息" note="这些是给部署和排错看的参数，新用户不需要修改。" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <InfoRow label="Node" value={runtime.nodeVersion} />
          <InfoRow label="平台" value={`${runtime.platform} / ${runtime.arch}`} />
          <InfoRow label="OpenAI 文本模型" value={process.env.OPENAI_TEXT_MODEL || 'gpt-5.4'} />
          <InfoRow label="OpenAI 图片模型" value={process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'} />
          <InfoRow label="OpenAI TTS 模型" value={process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'} />
          <InfoRow label="OpenAI TTS 声音" value={process.env.OPENAI_TTS_VOICE || 'alloy'} />
          <InfoRow label="CosyVoice 模型" value={voiceSettings.cosyvoiceModel || '未设置'} />
          <InfoRow label="CosyVoice 克隆模型" value={voiceSettings.cosyvoiceCloneModel || '未设置'} />
          <InfoRow label="MiniMax TTS 模型" value={voiceSettings.minimaxTtsModel || '未设置'} />
          <InfoRow label="MiniMax 克隆模型" value={voiceSettings.minimaxCloneModel || '未设置'} />
          <InfoRow label="OSS Bucket" value={voiceSettings.aliyunOssBucket || '未设置'} />
          <InfoRow label="ffmpeg 命令" value={runtime.ffmpegCommand} />
        </div>
      </Panel>
    </StudioShell>
  );
}

function SettingRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ ...subtlePanelStyle, padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
      <span style={{ color: '#cbd5e1' }}>{label}</span>
      <StatusBadge text={value} tone={ok ? 'success' : 'warning'} />
    </div>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...subtlePanelStyle, padding: 12, display: 'grid', gap: 5 }}>
      <span style={{ color: '#7f8da3', fontSize: 12 }}>{label}</span>
      <span style={{ color: '#e2e8f0', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...subtlePanelStyle, padding: 12, display: 'grid', gap: 5 }}>
      <span style={{ color: '#7f8da3', fontSize: 12 }}>{label}</span>
      <span style={{ color: '#e2e8f0', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

function voiceServiceReady(settings: Awaited<ReturnType<typeof getSafeVoiceSettings>>) {
  if (settings.provider === 'aliyun-cosyvoice') return Boolean(settings.dashscopeApiKey);
  if (settings.provider === 'minimax') return Boolean(settings.minimaxApiKey);
  return Boolean(settings.voiceCloneEndpoint && settings.voiceTtsEndpoint);
}

function formatProvider(provider: string) {
  if (provider === 'aliyun-cosyvoice') return 'CosyVoice';
  if (provider === 'minimax') return 'MiniMax';
  return '自定义接口';
}
