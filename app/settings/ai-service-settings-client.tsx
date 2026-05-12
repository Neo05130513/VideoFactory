'use client';

import { useState } from 'react';

type AiProvider = 'openai' | 'minimax';

type AiSettingsView = {
  textGenerationProvider: AiProvider;
  videoImageProvider: AiProvider;
  videoSpeechProvider: AiProvider;
  openaiApiKey?: string;
  openaiBaseUrl: string;
  openaiTextBaseUrl: string;
  openaiImageBaseUrl: string;
  openaiTtsBaseUrl: string;
  openaiTextModel: string;
  openaiImageModel: string;
  openaiTtsModel: string;
  openaiTtsVoice: string;
  openaiReasoningEffort: string;
  openaiImageSize?: string;
  openaiImageQuality?: string;
  minimaxApiKey?: string;
  minimaxBaseUrl: string;
  minimaxTextBaseUrl: string;
  minimaxTextModel: string;
  minimaxImageModel: string;
  minimaxTtsModel: string;
  updatedAt: string;
};

export function AiServiceSettingsClient({ initialSettings }: { initialSettings: AiSettingsView }) {
  const [settings, setSettings] = useState<AiSettingsView>(initialSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function update<K extends keyof AiSettingsView>(key: K, value: AiSettingsView[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setMessage('正在保存 AI 服务配置...');
    try {
      const response = await fetch('/api/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, ...extra })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '保存 AI 服务配置失败');
      }
      setSettings(payload.settings);
      setMessage('AI 服务配置已保存，后续脚本、分镜、出图和旁白会使用新配置。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存 AI 服务配置失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <ProviderSelect label="文本生成" value={settings.textGenerationProvider} onChange={(value) => update('textGenerationProvider', value)} />
        <ProviderSelect label="关键帧出图" value={settings.videoImageProvider} onChange={(value) => update('videoImageProvider', value)} />
        <ProviderSelect label="视频旁白" value={settings.videoSpeechProvider} onChange={(value) => update('videoSpeechProvider', value)} />
      </div>

      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>OpenAI / 兼容网关</div>
        <div style={gridStyle}>
          <Field label="API Key" value={settings.openaiApiKey || ''} onChange={(value) => update('openaiApiKey', value)} placeholder="已配置则显示 configured，输入新 key 可覆盖" />
          <Field label="Base URL" value={settings.openaiBaseUrl || ''} onChange={(value) => update('openaiBaseUrl', value)} placeholder="https://api.openai.com 或兼容网关" />
          <Field label="文本 Base URL" value={settings.openaiTextBaseUrl || ''} onChange={(value) => update('openaiTextBaseUrl', value)} />
          <Field label="图片 Base URL" value={settings.openaiImageBaseUrl || ''} onChange={(value) => update('openaiImageBaseUrl', value)} />
          <Field label="TTS Base URL" value={settings.openaiTtsBaseUrl || ''} onChange={(value) => update('openaiTtsBaseUrl', value)} />
          <Field label="文本模型" value={settings.openaiTextModel || ''} onChange={(value) => update('openaiTextModel', value)} />
          <Field label="图片模型" value={settings.openaiImageModel || ''} onChange={(value) => update('openaiImageModel', value)} />
          <Field label="TTS 模型" value={settings.openaiTtsModel || ''} onChange={(value) => update('openaiTtsModel', value)} />
          <Field label="TTS 声音" value={settings.openaiTtsVoice || ''} onChange={(value) => update('openaiTtsVoice', value)} />
          <Field label="推理强度" value={settings.openaiReasoningEffort || ''} onChange={(value) => update('openaiReasoningEffort', value)} placeholder="none / low / medium / high" />
          <Field label="图片尺寸" value={settings.openaiImageSize || ''} onChange={(value) => update('openaiImageSize', value)} placeholder="留空自动按画幅推断" />
          <Field label="图片质量" value={settings.openaiImageQuality || ''} onChange={(value) => update('openaiImageQuality', value)} placeholder="auto / high / medium / low" />
        </div>
        <button type="button" onClick={() => saveSettings({ clearOpenAiApiKey: true, openaiApiKey: '' })} disabled={busy} style={secondaryButtonStyle}>
          清除 OpenAI 覆盖 Key
        </button>
      </div>

      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>MiniMax</div>
        <div style={gridStyle}>
          <Field label="API Key" value={settings.minimaxApiKey || ''} onChange={(value) => update('minimaxApiKey', value)} placeholder="已配置则显示 configured，输入新 key 可覆盖" />
          <Field label="Base URL" value={settings.minimaxBaseUrl || ''} onChange={(value) => update('minimaxBaseUrl', value)} />
          <Field label="文本 Base URL" value={settings.minimaxTextBaseUrl || ''} onChange={(value) => update('minimaxTextBaseUrl', value)} />
          <Field label="文本模型" value={settings.minimaxTextModel || ''} onChange={(value) => update('minimaxTextModel', value)} />
          <Field label="图片模型" value={settings.minimaxImageModel || ''} onChange={(value) => update('minimaxImageModel', value)} />
          <Field label="TTS 模型" value={settings.minimaxTtsModel || ''} onChange={(value) => update('minimaxTtsModel', value)} />
        </div>
        <button type="button" onClick={() => saveSettings({ clearMiniMaxApiKey: true, minimaxApiKey: '' })} disabled={busy} style={secondaryButtonStyle}>
          清除 MiniMax 覆盖 Key
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => saveSettings()} disabled={busy} style={primaryButtonStyle}>
          {busy ? '保存中...' : '保存 AI 服务配置'}
        </button>
        {message ? <span style={{ color: message.includes('失败') || message.includes('Forbidden') ? '#fecaca' : '#86efac', lineHeight: 1.6 }}>{message}</span> : null}
      </div>
    </div>
  );
}

function ProviderSelect({ label, value, onChange }: { label: string; value: AiProvider; onChange: (value: AiProvider) => void }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as AiProvider)} style={inputStyle}>
        <option value="openai">OpenAI</option>
        <option value="minimax">MiniMax</option>
      </select>
    </label>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={inputStyle} />
    </label>
  );
}

const sectionStyle = {
  display: 'grid',
  gap: 12,
  borderRadius: 16,
  padding: 14,
  background: 'rgba(15,23,42,0.62)',
  border: '1px solid rgba(148,163,184,0.16)'
} as const;

const sectionHeaderStyle = {
  color: '#f8fafc',
  fontWeight: 850
} as const;

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10
} as const;

const labelStyle = {
  color: '#94a3b8',
  fontSize: 12
} as const;

const inputStyle = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid rgba(148,163,184,0.22)',
  background: 'rgba(2,6,23,0.68)',
  color: '#e2e8f0',
  padding: 11
} as const;

const primaryButtonStyle = {
  border: 'none',
  borderRadius: 999,
  padding: '12px 18px',
  background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
  color: '#eff6ff',
  fontWeight: 800,
  cursor: 'pointer'
} as const;

const secondaryButtonStyle = {
  border: '1px solid rgba(148,163,184,0.28)',
  borderRadius: 999,
  padding: '10px 14px',
  background: 'rgba(15,23,42,0.72)',
  color: '#cbd5e1',
  fontWeight: 750,
  cursor: 'pointer',
  justifySelf: 'start'
} as const;
