'use client';

import { useEffect, useMemo, useState } from 'react';
import { navigatePendingWindow, openPendingWindow } from '../_components/open-new-window';
import type { Script, VideoProject } from '@/lib/types';

type ProjectAspectRatio = '9:16' | '16:9';
type ProjectTemplate = 'ai-explainer-short-v1' | 'hyperframes-explainer-v1' | 'tech-explainer-v1' | 'tutorial-demo-v1';

type VoiceSettingsView = {
  provider: 'aliyun-cosyvoice' | 'minimax' | 'custom-http';
  dashscopeApiKey?: string;
  dashscopeBaseUrl?: string;
  cosyvoiceModel?: string;
  cosyvoiceCloneModel?: string;
  cosyvoiceTestVoiceId?: string;
  cosyvoiceVoicePrefix?: string;
  cosyvoicePublicBaseUrl?: string;
  cosyvoiceChunkCharLimit?: number;
  aliyunOssRegion?: string;
  aliyunOssEndpoint?: string;
  aliyunOssBucket?: string;
  aliyunOssAccessKeyId?: string;
  aliyunOssAccessKeySecret?: string;
  aliyunOssPrefix?: string;
  aliyunOssSignedUrlExpiresSec?: number;
  minimaxApiKey?: string;
  minimaxBaseUrl?: string;
  minimaxTtsModel?: string;
  minimaxCloneModel?: string;
  minimaxLanguageBoost?: string;
  minimaxVoicePrefix?: string;
  voiceCloneEndpoint?: string;
  voiceTtsEndpoint?: string;
  voiceProviderApiKey?: string;
};

type VoiceProfileView = {
  id: string;
  name: string;
  provider: VoiceSettingsView['provider'];
  status: 'sample_uploaded' | 'ready' | 'failed';
  samplePath: string;
  sampleObjectKey?: string;
  sampleStorageProvider?: 'aliyun-oss';
  providerVoiceId?: string;
  lastError?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_OPENAI_IMAGE_TEST_PROMPT = 'Create a high-end cinematic vertical keyframe for Chinese short video: a product manager in a modern startup office using AI to design a premium product introduction PPT, realistic photography, believable monitor UI, polished desk setup, dramatic but natural lighting, commercial ad quality, 9:16, no watermark, no gibberish text.';

const templateOptions: Array<{ value: ProjectTemplate; label: string; note: string }> = [
  { value: 'ai-explainer-short-v1', label: 'AI 科普短视频', note: '高密度观点、关键词、卡片和数据模块' },
  { value: 'hyperframes-explainer-v1', label: 'Hyperframes 视觉实验', note: 'HTML 卡片、浏览器框和动态图层，适合高质感短视频' },
  { value: 'tech-explainer-v1', label: '技术解释器', note: '框架化拆解，适合流程和方法论' },
  { value: 'tutorial-demo-v1', label: '教程演示', note: '偏步骤教学和操作说明' }
];

function templateLabel(template: string) {
  return templateOptions.find((item) => item.value === template)?.label || template;
}

export function VideoActionsPanel({ scripts, projects }: { scripts: Script[]; projects: VideoProject[] }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const [openaiImagePrompt, setOpenAIImagePrompt] = useState(DEFAULT_OPENAI_IMAGE_TEST_PROMPT);
  const [testImagePath, setTestImagePath] = useState<string>('');
  const [testImageUrl, setTestImageUrl] = useState<string>('');
  const [selectedScriptIds, setSelectedScriptIds] = useState<string[]>([]);
  const [projectAspectRatio, setProjectAspectRatio] = useState<ProjectAspectRatio>('9:16');
  const [projectTemplate, setProjectTemplate] = useState<ProjectTemplate>('ai-explainer-short-v1');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [jobStates, setJobStates] = useState<Record<string, string>>({});
  const [qualitySummary, setQualitySummary] = useState<string>('');
  const [voiceName, setVoiceName] = useState('我的旁白音色');
  const [voiceSample, setVoiceSample] = useState<File | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsView>({
    provider: 'aliyun-cosyvoice',
    dashscopeBaseUrl: 'https://dashscope.aliyuncs.com',
    cosyvoiceModel: 'cosyvoice-v2',
    cosyvoiceCloneModel: 'voice-enrollment',
    cosyvoiceTestVoiceId: 'longxiaochun_v2',
    cosyvoiceVoicePrefix: 'videofactory',
    cosyvoiceChunkCharLimit: 1800,
    aliyunOssPrefix: 'video-factory/voice-samples',
    aliyunOssSignedUrlExpiresSec: 3600,
    minimaxBaseUrl: 'https://api.minimaxi.com',
    minimaxTtsModel: 'speech-2.8-hd',
    minimaxCloneModel: 'speech-2.8-hd',
    minimaxLanguageBoost: 'Chinese',
    minimaxVoicePrefix: 'VideoFactory'
  });
  const [ttsTestText, setTtsTestText] = useState('这是一段长文本语音合成测试，用来验证视频工厂的音频生成、自动切分、拼接和时长同步能力。');
  const [ttsTestResult, setTtsTestResult] = useState<string>('');
  const [ttsTestAudioUrl, setTtsTestAudioUrl] = useState<string>('');
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfileView[]>([]);

  const pendingScripts = useMemo(() => scripts.filter((script) => !projects.some((project) => project.scriptId === script.id)), [projects, scripts]);
  const renderableProjects = useMemo(() => projects.filter((project) => project.status !== 'rendering'), [projects]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const results = await Promise.all(renderableProjects.slice(0, 12).map(async (project) => {
          const response = await fetch(`/api/videos/${project.id}/render-job`, { cache: 'no-store' });
          const payload = await response.json();
          return [project.id, payload.job?.status || 'idle'] as const;
        }));
        if (!cancelled) {
          setJobStates(Object.fromEntries(results));
          const hasActive = results.some(([, status]) => status === 'queued' || status === 'running');
          if (hasActive) timer = setTimeout(poll, 2500);
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
  }, [renderableProjects]);

  async function loadVoiceProfiles() {
    const response = await fetch('/api/voices/profiles', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || '加载音色列表失败');
    }
    setVoiceProfiles(payload.profiles || []);
  }

  useEffect(() => {
    let active = true;
    async function loadVoicePanelState() {
      try {
        const [settingsResponse, profilesResponse] = await Promise.all([
          fetch('/api/voices/settings', { cache: 'no-store' }),
          fetch('/api/voices/profiles', { cache: 'no-store' })
        ]);
        const settingsPayload = await settingsResponse.json();
        const profilesPayload = await profilesResponse.json();
        if (!active) return;
        if (settingsResponse.ok && settingsPayload.settings) setVoiceSettings(settingsPayload.settings);
        if (profilesResponse.ok && profilesPayload.profiles) setVoiceProfiles(profilesPayload.profiles);
      } catch {}
    }
    void loadVoicePanelState();
    return () => {
      active = false;
    };
  }, []);

  async function createProject(scriptId: string) {
    const nextWindow = openPendingWindow();
    const key = `create:${scriptId}`;
    setBusyKey(key);
    setMessage('正在创建视频项目...');
    try {
      const response = await fetch('/api/videos/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId, aspectRatio: projectAspectRatio, template: projectTemplate })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '创建失败');
      }
      setMessage('视频项目创建成功，已在新窗口打开。');
      navigatePendingWindow(nextWindow, `/videos/${payload.project.id}`);
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '创建视频项目失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function createSelectedProjects() {
    if (selectedScriptIds.length === 0) {
      setMessage('请先至少选择一条脚本。');
      return;
    }
    const nextWindow = openPendingWindow();
    const key = 'batch-create';
    setBusyKey(key);
    setMessage('正在批量创建视频项目...');
    try {
      const response = await fetch('/api/videos/batch-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptIds: selectedScriptIds, aspectRatio: projectAspectRatio, template: projectTemplate })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '批量创建失败');
      }
      const firstProjectId = payload.results?.[0]?.project?.id;
      setMessage(`批量创建完成，共处理 ${selectedScriptIds.length} 条脚本，已在新窗口打开视频库。`);
      navigatePendingWindow(nextWindow, firstProjectId ? `/videos/${firstProjectId}` : '/videos');
    } catch (error) {
      nextWindow?.close();
      setMessage(error instanceof Error ? error.message : '批量创建视频项目失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function renderProject(projectId: string) {
    const key = `render:${projectId}`;
    setBusyKey(key);
    setMessage('正在提交渲染任务，请稍等...');
    try {
      const response = await fetch(`/api/videos/${projectId}/render`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '渲染失败');
      }
      setJobStates((current) => ({ ...current, [projectId]: payload.job?.status || 'queued' }));
      setMessage('渲染任务已进入队列，系统将异步执行。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '渲染视频失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function renderSelectedProjects() {
    if (selectedProjectIds.length === 0) {
      setMessage('请先至少选择一个视频项目。');
      return;
    }
    const key = 'batch-render';
    setBusyKey(key);
    setMessage('正在提交批量渲染任务...');
    try {
      const response = await fetch('/api/videos/batch-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds: selectedProjectIds })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '批量渲染提交失败');
      }
      setJobStates((current) => ({
        ...current,
        ...Object.fromEntries((payload.jobs || []).map((job: { projectId: string; status: string }) => [job.projectId, job.status || 'queued']))
      }));
      setMessage(`批量渲染任务已提交，共处理 ${selectedProjectIds.length} 个项目。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量渲染失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function retryProjectRender(projectId: string) {
    const key = `render-retry:${projectId}`;
    setBusyKey(key);
    setMessage('正在重新提交渲染任务...');
    try {
      const response = await fetch(`/api/videos/${projectId}/render-retry`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '重试渲染失败');
      }
      setJobStates((current) => ({ ...current, [projectId]: payload.job?.status || 'queued' }));
      setMessage('渲染重试任务已进入队列。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重试渲染失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function testOpenAIImage() {
    const key = 'openai-image-test';
    setBusyKey(key);
    setMessage('正在请求 OpenAI 出图...');
    setTestImagePath('');
    setTestImageUrl('');
    try {
      const response = await fetch('/api/openai/image-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: openaiImagePrompt })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'OpenAI 图片测试失败');
      }
      const endpoint = payload.endpoint ? `（命中 ${payload.endpoint}）` : '';
      setTestImagePath(payload.image?.publicPath || '');
      setTestImageUrl(payload.imageUrl || '');
      setMessage(`OpenAI 图片测试成功${endpoint}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'OpenAI 图片测试失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function runQualitySampling() {
    const key = 'quality-sample';
    setBusyKey(key);
    setMessage('正在执行自动抽样质检...');
    try {
      const response = await fetch('/api/videos/quality-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleSize: 3 })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '抽样质检失败');
      }
      const decisionSummary = (payload.reviews || []).map((item: { publishDecision: string }) => item.publishDecision).join(', ') || '无新增样本';
      setQualitySummary(`round=${payload.round} · sampled=${payload.sampled} · decisions=${decisionSummary}`);
      setMessage('自动抽样质检完成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '自动抽样质检失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadVoiceSample() {
    if (!voiceSample) {
      setMessage('请先选择一段声音样本。');
      return;
    }

    const key = 'voice-upload';
    setBusyKey(key);
    setMessage('正在上传声音样本...');
    try {
      const form = new FormData();
      form.append('sample', voiceSample);
      form.append('name', voiceName);
      const response = await fetch('/api/voices/upload', {
        method: 'POST',
        body: form
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.profile) {
          setVoiceProfiles((current) => [payload.profile, ...current.filter((profile) => profile.id !== payload.profile.id)]);
        }
        throw new Error(payload.error || '上传声音样本失败');
      }
      await loadVoiceProfiles();
      const statusText = payload.profile?.status === 'ready' ? '声音复刻已完成' : '声音样本已保存';
      setMessage(`${statusText}：${payload.profile?.name || voiceName}。渲染时会使用该默认音色生成旁白。`);
      setVoiceSample(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '上传声音样本失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function saveVoiceSettings() {
    const key = 'voice-settings';
    setBusyKey(key);
    setMessage('正在保存语音配置...');
    try {
      const response = await fetch('/api/voices/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(voiceSettings)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '保存语音配置失败');
      }
      setVoiceSettings(payload.settings);
      setMessage('语音配置已保存。后续上传音色和渲染会使用新的配置。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存语音配置失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function retryVoiceClone(profileId: string) {
    const key = `voice-retry:${profileId}`;
    setBusyKey(key);
    setMessage('正在重试声音复刻...');
    try {
      const response = await fetch(`/api/voices/profiles/${profileId}/retry`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.profile) {
          setVoiceProfiles((current) => current.map((profile) => profile.id === profileId ? payload.profile : profile));
        }
        throw new Error(payload.error || '重试声音复刻失败');
      }
      await loadVoiceProfiles();
      setMessage(`声音复刻成功：${payload.profile?.name || profileId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重试声音复刻失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function setDefaultVoice(profileId: string) {
    const key = `voice-default:${profileId}`;
    setBusyKey(key);
    setMessage('正在设置默认音色...');
    try {
      const response = await fetch(`/api/voices/profiles/${profileId}/default`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '设置默认音色失败');
      }
      await loadVoiceProfiles();
      setMessage(`默认音色已切换为：${payload.profile?.name || profileId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '设置默认音色失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function testProviderTts() {
    const key = 'voice-tts-test';
    setBusyKey(key);
    setMessage(`正在测试 ${voiceSettings.provider === 'aliyun-cosyvoice' ? 'CosyVoice' : 'MiniMax'} TTS...`);
    setTtsTestResult('');
    setTtsTestAudioUrl('');
    try {
      const response = await fetch('/api/voices/test-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ttsTestText,
          voiceId: voiceSettings.provider === 'aliyun-cosyvoice'
            ? (voiceSettings.cosyvoiceTestVoiceId || 'longxiaochun_v2')
            : 'female-tianmei'
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'TTS 测试失败');
      }
      setTtsTestAudioUrl(payload.audio?.publicPath || '');
      setTtsTestResult(`模型 ${payload.model} · 时长 ${Number(payload.durationSec).toFixed(2)} 秒 · ${payload.audio?.publicPath || ''}`);
      setMessage('TTS 测试成功。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'TTS 测试失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function testVoiceStorage() {
    const key = 'voice-storage-test';
    setBusyKey(key);
    setMessage('正在测试 Aliyun OSS 样音存储...');
    try {
      const settingsResponse = await fetch('/api/voices/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(voiceSettings)
      });
      const settingsPayload = await settingsResponse.json();
      if (!settingsResponse.ok) {
        throw new Error(settingsPayload.error || '保存语音配置失败');
      }
      setVoiceSettings(settingsPayload.settings);
      const response = await fetch('/api/voices/storage-test', {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'OSS 存储测试失败');
      }
      setMessage(`OSS 存储测试成功：${payload.storage?.objectKey || ''}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'OSS 存储测试失败');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section style={{ background: 'rgba(15,23,42,0.82)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 24, display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>快速操作</h2>
          <p style={{ margin: '8px 0 0', color: '#cbd5e1' }}>先从脚本创建视频项目，再对项目执行 render。当前页面默认使用 OpenAI 生成图片素材；如显式设置 VIDEO_IMAGE_PROVIDER=minimax 才走旧 MiniMax，失败时回退到本地占位图。</p>
        </div>
        {message ? <div style={{ color: '#93c5fd', maxWidth: 420 }}>{message}</div> : null}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <SurfacePill text={`待创建脚本 ${pendingScripts.length} 条`} tone="#67e8f9" bg="rgba(6,182,212,0.12)" />
        <SurfacePill text={`可渲染项目 ${renderableProjects.length} 个`} tone="#c4b5fd" bg="rgba(124,58,237,0.14)" />
        <SurfacePill text={`总项目 ${projects.length} 个`} tone="#bbf7d0" bg="rgba(34,197,94,0.14)" />
        <button onClick={runQualitySampling} disabled={busyKey !== null} style={buttonStyle(busyKey === 'quality-sample')}>
          {busyKey === 'quality-sample' ? '质检中...' : '抽样质检 3 条'}
        </button>
      </div>
      {qualitySummary ? <div style={{ color: '#86efac', lineHeight: 1.7 }}>{qualitySummary}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0, color: '#f8fafc' }}>语音模型 / API 设置</h3>
          <div style={{ color: '#cbd5e1', lineHeight: 1.7 }}>默认使用阿里云 CosyVoice，并以内置长文本切分 + 音频拼接规避单次长度限制。API Key 不会明文回显，显示 configured 表示已保存或已从环境变量读取。</div>
          <select
            value={voiceSettings.provider}
            onChange={(event) => setVoiceSettings((current) => ({ ...current, provider: event.target.value as VoiceSettingsView['provider'] }))}
            style={inputStyle}
          >
            <option value="aliyun-cosyvoice">阿里云 CosyVoice</option>
            <option value="minimax">MiniMax</option>
            <option value="custom-http">Custom HTTP</option>
          </select>
          {voiceSettings.provider === 'aliyun-cosyvoice' ? (
            <>
              <input value={voiceSettings.dashscopeApiKey || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, dashscopeApiKey: event.target.value }))} placeholder="DASHSCOPE_API_KEY / 留空则使用环境变量" style={inputStyle} />
              <input value={voiceSettings.dashscopeBaseUrl || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, dashscopeBaseUrl: event.target.value }))} placeholder="DashScope Base URL" style={inputStyle} />
              <select value={voiceSettings.cosyvoiceModel || 'cosyvoice-v2'} onChange={(event) => setVoiceSettings((current) => ({ ...current, cosyvoiceModel: event.target.value, cosyvoiceCloneModel: current.cosyvoiceCloneModel || event.target.value }))} style={inputStyle}>
                <option value="cosyvoice-v2">cosyvoice-v2</option>
                <option value="cosyvoice-v3-flash">cosyvoice-v3-flash</option>
                <option value="cosyvoice-v3-plus">cosyvoice-v3-plus</option>
              </select>
              <input value={voiceSettings.cosyvoiceCloneModel || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, cosyvoiceCloneModel: event.target.value }))} placeholder="声音复刻模型，例如 voice-enrollment" style={inputStyle} />
              <input value={voiceSettings.cosyvoiceTestVoiceId || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, cosyvoiceTestVoiceId: event.target.value }))} placeholder="测试用预置 voice，例如 longxiaochun_v2" style={inputStyle} />
              <input value={voiceSettings.cosyvoiceVoicePrefix || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, cosyvoiceVoicePrefix: event.target.value }))} placeholder="自定义音色前缀，例如 videofactory" style={inputStyle} />
              <input type="number" value={voiceSettings.cosyvoiceChunkCharLimit || 1800} onChange={(event) => setVoiceSettings((current) => ({ ...current, cosyvoiceChunkCharLimit: Number(event.target.value) || 1800 }))} placeholder="长文本切分字符预算" style={inputStyle} />
              <div style={{ color: '#f8fafc', fontWeight: 800, marginTop: 8 }}>生产样音存储 / Aliyun OSS</div>
              <input value={voiceSettings.aliyunOssRegion || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, aliyunOssRegion: event.target.value }))} placeholder="ALIYUN_OSS_REGION，例如 oss-cn-hangzhou" style={inputStyle} />
              <input value={voiceSettings.aliyunOssEndpoint || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, aliyunOssEndpoint: event.target.value }))} placeholder="ALIYUN_OSS_ENDPOINT，可选，例如 oss-cn-hangzhou.aliyuncs.com" style={inputStyle} />
              <input value={voiceSettings.aliyunOssBucket || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, aliyunOssBucket: event.target.value }))} placeholder="ALIYUN_OSS_BUCKET" style={inputStyle} />
              <input value={voiceSettings.aliyunOssAccessKeyId || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, aliyunOssAccessKeyId: event.target.value }))} placeholder="ALIYUN_OSS_ACCESS_KEY_ID" style={inputStyle} />
              <input value={voiceSettings.aliyunOssAccessKeySecret || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, aliyunOssAccessKeySecret: event.target.value }))} placeholder="ALIYUN_OSS_ACCESS_KEY_SECRET / configured 表示已配置" style={inputStyle} />
              <input value={voiceSettings.aliyunOssPrefix || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, aliyunOssPrefix: event.target.value }))} placeholder="OSS 对象前缀，例如 video-factory/voice-samples" style={inputStyle} />
              <input type="number" value={voiceSettings.aliyunOssSignedUrlExpiresSec || 3600} onChange={(event) => setVoiceSettings((current) => ({ ...current, aliyunOssSignedUrlExpiresSec: Number(event.target.value) || 3600 }))} placeholder="签名 URL 有效秒数" style={inputStyle} />
              <button type="button" onClick={testVoiceStorage} disabled={busyKey !== null} style={buttonStyle(busyKey === 'voice-storage-test')}>
                {busyKey === 'voice-storage-test' ? '测试存储中...' : '测试 OSS 存储'}
              </button>
            </>
          ) : voiceSettings.provider === 'minimax' ? (
            <>
              <input value={voiceSettings.minimaxApiKey || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, minimaxApiKey: event.target.value }))} placeholder="MINIMAX_API_KEY / 留空则使用环境变量" style={inputStyle} />
              <input value={voiceSettings.minimaxBaseUrl || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, minimaxBaseUrl: event.target.value }))} placeholder="MiniMax Base URL" style={inputStyle} />
              <select value={voiceSettings.minimaxTtsModel || 'speech-2.8-hd'} onChange={(event) => setVoiceSettings((current) => ({ ...current, minimaxTtsModel: event.target.value, minimaxCloneModel: current.minimaxCloneModel || event.target.value }))} style={inputStyle}>
                <option value="speech-2.8-hd">speech-2.8-hd</option>
                <option value="speech-2.8-turbo">speech-2.8-turbo</option>
                <option value="speech-02-hd">speech-02-hd</option>
                <option value="speech-02-turbo">speech-02-turbo</option>
              </select>
              <input value={voiceSettings.minimaxCloneModel || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, minimaxCloneModel: event.target.value }))} placeholder="声音克隆模型，默认与 TTS 模型一致" style={inputStyle} />
              <input value={voiceSettings.minimaxLanguageBoost || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, minimaxLanguageBoost: event.target.value }))} placeholder="language_boost，例如 Chinese" style={inputStyle} />
              <input value={voiceSettings.minimaxVoicePrefix || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, minimaxVoicePrefix: event.target.value }))} placeholder="自定义 voice_id 前缀" style={inputStyle} />
            </>
          ) : (
            <>
              <input value={voiceSettings.voiceProviderApiKey || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, voiceProviderApiKey: event.target.value }))} placeholder="Custom Provider API Key" style={inputStyle} />
              <input value={voiceSettings.voiceCloneEndpoint || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, voiceCloneEndpoint: event.target.value }))} placeholder="VOICE_CLONE_ENDPOINT" style={inputStyle} />
              <input value={voiceSettings.voiceTtsEndpoint || ''} onChange={(event) => setVoiceSettings((current) => ({ ...current, voiceTtsEndpoint: event.target.value }))} placeholder="VOICE_TTS_ENDPOINT" style={inputStyle} />
            </>
          )}
          <button onClick={saveVoiceSettings} disabled={busyKey !== null} style={buttonStyle(busyKey === 'voice-settings')}>
            {busyKey === 'voice-settings' ? '保存中...' : '保存语音配置'}
          </button>
          {voiceSettings.provider === 'minimax' || voiceSettings.provider === 'aliyun-cosyvoice' ? (
            <div style={{ display: 'grid', gap: 10, borderRadius: 18, padding: 14, background: 'rgba(15,23,42,0.62)', border: '1px solid rgba(148,163,184,0.16)' }}>
              <div style={{ color: '#f8fafc', fontWeight: 800 }}>{voiceSettings.provider === 'aliyun-cosyvoice' ? 'CosyVoice 长文本 TTS 测试' : 'MiniMax TTS 连通性测试'}</div>
              <textarea
                value={ttsTestText}
                onChange={(event) => setTtsTestText(event.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={testProviderTts} disabled={busyKey !== null} style={buttonStyle(busyKey === 'voice-tts-test')}>
                  {busyKey === 'voice-tts-test' ? '测试中...' : '测试 TTS'}
                </button>
                {ttsTestAudioUrl ? <a href={ttsTestAudioUrl} target="_blank" rel="noreferrer" style={{ color: '#fbbf24' }}>打开测试音频</a> : null}
              </div>
              {ttsTestResult ? <div style={{ color: '#86efac', lineHeight: 1.6 }}>{ttsTestResult}</div> : null}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0, color: '#f8fafc' }}>上传我的声音</h3>
          <div style={{ color: '#cbd5e1', lineHeight: 1.7 }}>
            上传一段干净人声样本。CosyVoice 会自动裁出 20 秒 WAV 样音并上传到生产 OSS，复刻成功后渲染会用默认音色生成旁白，并用音频真实时长同步 Remotion 时间线。
          </div>
          <input
            value={voiceName}
            onChange={(event) => setVoiceName(event.target.value)}
            placeholder="音色名称"
            style={{ width: '100%', borderRadius: 14, border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(2,6,23,0.68)', color: '#e2e8f0', padding: 12 }}
          />
          <input
            type="file"
            accept="audio/*"
            onChange={(event) => setVoiceSample(event.target.files?.[0] || null)}
            style={{ color: '#cbd5e1' }}
          />
          <button onClick={uploadVoiceSample} disabled={busyKey !== null || !voiceSample} style={buttonStyle(busyKey === 'voice-upload')}>
            {busyKey === 'voice-upload' ? '上传中...' : '保存默认音色'}
          </button>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: '#f8fafc', fontWeight: 800 }}>已保存音色</div>
            {voiceProfiles.length === 0 ? (
              <div style={{ color: '#94a3b8', lineHeight: 1.7 }}>还没有上传过音色。配置好 OSS 后，上传一段真实样音即可生成默认旁白音色。</div>
            ) : voiceProfiles.map((profile) => {
              const statusText = profile.status === 'ready' ? '可用' : profile.status === 'failed' ? '失败' : '待复刻';
              const statusColor = profile.status === 'ready' ? '#86efac' : profile.status === 'failed' ? '#fecaca' : '#fde68a';
              return (
                <div key={profile.id} style={{ borderRadius: 16, padding: 14, background: 'rgba(15,23,42,0.62)', border: '1px solid rgba(148,163,184,0.16)', display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ color: '#f8fafc', fontWeight: 800 }}>{profile.name}{profile.isDefault ? ' · 默认' : ''}</div>
                      <div style={{ color: '#94a3b8', fontSize: 12 }}>{profile.provider} · {profile.sampleStorageProvider || 'local'} · {new Date(profile.updatedAt).toLocaleString()}</div>
                    </div>
                    <div style={{ color: statusColor, fontWeight: 800 }}>{statusText}</div>
                  </div>
                  {profile.providerVoiceId ? <div style={{ color: '#cbd5e1', fontSize: 12 }}>voiceId: {profile.providerVoiceId}</div> : null}
                  {profile.sampleObjectKey ? <div style={{ color: '#94a3b8', fontSize: 12, overflowWrap: 'anywhere' }}>OSS: {profile.sampleObjectKey}</div> : null}
                  {profile.lastError ? <div style={{ color: '#fecaca', lineHeight: 1.6 }}>失败原因：{profile.lastError}</div> : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => retryVoiceClone(profile.id)} disabled={busyKey !== null} style={buttonStyle(busyKey === `voice-retry:${profile.id}`)}>
                      {busyKey === `voice-retry:${profile.id}` ? '重试中...' : '重试复刻'}
                    </button>
                    <button type="button" onClick={() => setDefaultVoice(profile.id)} disabled={busyKey !== null || profile.isDefault} style={buttonStyle(busyKey === `voice-default:${profile.id}`)}>
                      {profile.isDefault ? '当前默认' : '设为默认'}
                    </button>
                    <a href={profile.samplePath} target="_blank" rel="noreferrer" style={{ color: '#fbbf24', alignSelf: 'center' }}>试听样音</a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0, color: '#f8fafc' }}>OpenAI 单图测试</h3>
          <textarea
            value={openaiImagePrompt}
            onChange={(event) => setOpenAIImagePrompt(event.target.value)}
            rows={8}
            style={{ width: '100%', borderRadius: 16, border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(2,6,23,0.68)', color: '#e2e8f0', padding: 14, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={testOpenAIImage}
              disabled={busyKey !== null}
              style={buttonStyle(busyKey === 'openai-image-test')}
            >
              {busyKey === 'openai-image-test' ? '测试中...' : '测试 OpenAI 出图'}
            </button>
            {testImageUrl ? <a href={testImageUrl} target="_blank" rel="noreferrer" style={{ color: '#fbbf24' }}>打开测试图片</a> : null}
          </div>
          {testImageUrl ? <img src={testImageUrl} alt="OpenAI test output" style={{ width: 220, borderRadius: 18, border: '1px solid rgba(255,255,255,0.12)' }} /> : null}
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0, color: '#f8fafc' }}>从脚本创建项目</h3>
          <div style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 16, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.16)' }}>
            <div style={{ color: '#f8fafc', fontWeight: 800 }}>视频比例</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {([
                ['9:16', '竖屏短视频'],
                ['16:9', '横屏课程/播放器']
              ] as Array<[ProjectAspectRatio, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setProjectAspectRatio(value)}
                  style={{
                    border: `1px solid ${projectAspectRatio === value ? '#67e8f9' : 'rgba(148,163,184,0.22)'}`,
                    borderRadius: 14,
                    padding: '10px 14px',
                    background: projectAspectRatio === value ? 'rgba(8,145,178,0.24)' : 'rgba(255,255,255,0.04)',
                    color: projectAspectRatio === value ? '#a5f3fc' : '#e5ecf7',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  {value} · {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 16, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.16)' }}>
            <div style={{ color: '#f8fafc', fontWeight: 800 }}>视频模板</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {templateOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setProjectTemplate(option.value)}
                  style={{
                    border: `1px solid ${projectTemplate === option.value ? '#67e8f9' : 'rgba(148,163,184,0.22)'}`,
                    borderRadius: 14,
                    padding: '12px 14px',
                    background: projectTemplate === option.value ? 'rgba(8,145,178,0.24)' : 'rgba(255,255,255,0.04)',
                    color: projectTemplate === option.value ? '#a5f3fc' : '#e5ecf7',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ fontWeight: 850 }}>{option.label}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>{option.note}</div>
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: 12, borderRadius: 16, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.16)' }}>
            <div style={{ color: '#cbd5e1', lineHeight: 1.7 }}>先勾选待创建脚本，再一键批量创建视频项目。已经创建过的视频脚本不会重复出现在这里。</div>
            <button onClick={createSelectedProjects} disabled={busyKey !== null || selectedScriptIds.length === 0} style={buttonStyle(busyKey === 'batch-create')}>
              {busyKey === 'batch-create' ? '批量创建中...' : `批量创建 ${selectedScriptIds.length} 条`}
            </button>
          </div>
          {pendingScripts.length === 0 ? (
            <p style={{ color: '#cbd5e1', margin: 0 }}>当前没有待创建脚本，说明脚本已经全部进入视频阶段或当前展示范围内没有可用脚本。</p>
          ) : pendingScripts.map((script) => (
            <label key={script.id} style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 16, padding: 14, background: 'rgba(2,6,23,0.55)', display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', cursor: 'pointer' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={selectedScriptIds.includes(script.id)}
                  onChange={() => setSelectedScriptIds((current) => current.includes(script.id) ? current.filter((item) => item !== script.id) : [...current, script.id])}
                  disabled={busyKey !== null}
                />
                <div>
                  <div style={{ color: '#f8fafc', fontWeight: 700 }}>{script.title}</div>
                  <div style={{ color: '#94a3b8', marginTop: 6 }}>{script.duration} · {script.style}</div>
                </div>
              </div>
              <button
                onClick={(event) => {
                  event.preventDefault();
                  void createProject(script.id);
                }}
                disabled={busyKey !== null}
                style={buttonStyle(busyKey === `create:${script.id}`)}
              >
                {busyKey === `create:${script.id}` ? '创建中...' : '单独创建'}
              </button>
            </label>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0, color: '#f8fafc' }}>对项目执行渲染</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: 12, borderRadius: 16, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.16)' }}>
            <div style={{ color: '#cbd5e1', lineHeight: 1.7 }}>勾选要执行的项目后，可以顺序批量渲染。`rendering` 状态的项目已自动排除。</div>
            <button onClick={renderSelectedProjects} disabled={busyKey !== null || selectedProjectIds.length === 0} style={buttonStyle(busyKey === 'batch-render')}>
              {busyKey === 'batch-render' ? '批量渲染中...' : `批量渲染 ${selectedProjectIds.length} 个`}
            </button>
          </div>
          {renderableProjects.length === 0 ? (
            <p style={{ color: '#cbd5e1', margin: 0 }}>先创建至少一个非渲染中的视频项目。</p>
          ) : renderableProjects.slice(0, 12).map((project) => (
            <label key={project.id} style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 16, padding: 14, background: 'rgba(2,6,23,0.55)', display: 'grid', gap: 10, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={selectedProjectIds.includes(project.id)}
                    onChange={() => setSelectedProjectIds((current) => current.includes(project.id) ? current.filter((item) => item !== project.id) : [...current, project.id])}
                    disabled={busyKey !== null}
                  />
                  <div>
                    <div style={{ color: '#f8fafc', fontWeight: 700 }}>{project.title}</div>
                    <div style={{ color: '#94a3b8', marginTop: 6 }}>{project.status} · {templateLabel(project.template)} · 队列状态 {jobStates[project.id] || 'idle'} · {new Date(project.updatedAt).toLocaleString('zh-CN', { hour12: false })}</div>
                    {project.lastError ? <div style={{ marginTop: 8, color: '#fecaca', lineHeight: 1.7 }}>失败原因：{project.lastError}</div> : null}
                  </div>
                </div>
                <button
                  onClick={(event) => {
                    event.preventDefault();
                    void renderProject(project.id);
                  }}
                  disabled={busyKey !== null || jobStates[project.id] === 'queued' || jobStates[project.id] === 'running'}
                  style={buttonStyle(busyKey === `render:${project.id}` || jobStates[project.id] === 'queued' || jobStates[project.id] === 'running')}
                >
                  {busyKey === `render:${project.id}` ? '提交中...' : jobStates[project.id] === 'queued' ? '排队中...' : jobStates[project.id] === 'running' ? '渲染中...' : '单独渲染'}
                </button>
                {jobStates[project.id] === 'failed' || project.status === 'failed' ? (
                  <button
                    onClick={(event) => {
                      event.preventDefault();
                      void retryProjectRender(project.id);
                    }}
                    disabled={busyKey !== null}
                    style={buttonStyle(busyKey === `render-retry:${project.id}`)}
                  >
                    {busyKey === `render-retry:${project.id}` ? '重试中...' : '重试渲染'}
                  </button>
                ) : null}
              </div>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

function buttonStyle(isBusy: boolean) {
  return {
    border: 'none',
    borderRadius: 999,
    padding: '12px 18px',
    background: isBusy ? '#1d4ed8' : 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
    color: '#eff6ff',
    fontWeight: 700,
    cursor: isBusy ? 'progress' : 'pointer',
    minWidth: 140,
    boxShadow: '0 10px 30px rgba(37,99,235,0.28)'
  } as const;
}

const inputStyle = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid rgba(148,163,184,0.22)',
  background: 'rgba(2,6,23,0.68)',
  color: '#e2e8f0',
  padding: 12
} as const;

function SurfacePill({ text, tone, bg }: { text: string; tone: string; bg: string }) {
  return <span style={{ padding: '8px 12px', borderRadius: 999, color: tone, background: bg, fontSize: 12 }}>{text}</span>;
}
