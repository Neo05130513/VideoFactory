import { nowIso, readJsonFile, writeJsonFile } from './storage';

export type AiProvider = 'openai' | 'minimax';

export interface AiServiceSettings {
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
}

export type AiServiceSettingsInput = Partial<AiServiceSettings> & {
  clearOpenAiApiKey?: boolean;
  clearMiniMaxApiKey?: boolean;
};

const settingsPath = 'data/ai-settings.json';
const defaultOpenAiBaseUrl = 'https://api.openai.com';
const defaultMiniMaxBaseUrl = 'https://api.minimaxi.com';
const defaultMiniMaxTextBaseUrl = 'https://api.minimax.io';

function clean(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeProvider(value: unknown, fallback: AiProvider = 'openai'): AiProvider {
  return String(value || '').toLowerCase() === 'minimax' ? 'minimax' : fallback;
}

function getEnvDefaults(): AiServiceSettings {
  const openaiBaseUrl = clean(process.env.OPENAI_BASE_URL) || defaultOpenAiBaseUrl;
  const minimaxBaseUrl = clean(process.env.MINIMAX_API_HOST)
    || clean(process.env.MINIMAX_BASE_URL)
    || defaultMiniMaxBaseUrl;

  return {
    textGenerationProvider: normalizeProvider(process.env.TEXT_GENERATION_PROVIDER || process.env.AI_TEXT_PROVIDER, 'openai'),
    videoImageProvider: normalizeProvider(process.env.VIDEO_IMAGE_PROVIDER || process.env.IMAGE_GENERATION_PROVIDER, 'openai'),
    videoSpeechProvider: normalizeProvider(process.env.VIDEO_SPEECH_PROVIDER || process.env.VIDEO_TTS_PROVIDER || process.env.TTS_PROVIDER, 'openai'),
    openaiApiKey: clean(process.env.OPENAI_API_KEY),
    openaiBaseUrl,
    openaiTextBaseUrl: clean(process.env.OPENAI_TEXT_BASE_URL) || openaiBaseUrl,
    openaiImageBaseUrl: clean(process.env.OPENAI_IMAGE_BASE_URL) || openaiBaseUrl,
    openaiTtsBaseUrl: clean(process.env.OPENAI_TTS_BASE_URL) || clean(process.env.OPENAI_SPEECH_BASE_URL) || openaiBaseUrl,
    openaiTextModel: clean(process.env.OPENAI_TEXT_MODEL) || 'gpt-5.4',
    openaiImageModel: clean(process.env.OPENAI_IMAGE_MODEL) || 'gpt-image-1',
    openaiTtsModel: clean(process.env.OPENAI_TTS_MODEL) || 'gpt-4o-mini-tts',
    openaiTtsVoice: clean(process.env.OPENAI_TTS_VOICE) || 'alloy',
    openaiReasoningEffort: clean(process.env.OPENAI_REASONING_EFFORT) || 'none',
    openaiImageSize: clean(process.env.OPENAI_IMAGE_SIZE),
    openaiImageQuality: clean(process.env.OPENAI_IMAGE_QUALITY),
    minimaxApiKey: clean(process.env.MINIMAX_API_KEY),
    minimaxBaseUrl,
    minimaxTextBaseUrl: clean(process.env.MINIMAX_TEXT_BASE_URL)
      || clean(process.env.MINIMAX_API_HOST)
      || clean(process.env.MINIMAX_BASE_URL)
      || defaultMiniMaxTextBaseUrl,
    minimaxTextModel: clean(process.env.MINIMAX_TEXT_MODEL) || 'MiniMax-M2.7',
    minimaxImageModel: clean(process.env.MINIMAX_IMAGE_MODEL) || 'image-01',
    minimaxTtsModel: clean(process.env.MINIMAX_TTS_MODEL) || 'speech-2.8-hd',
    updatedAt: nowIso()
  };
}

async function readStoredSettings(): Promise<Partial<AiServiceSettings>> {
  try {
    return await readJsonFile<Partial<AiServiceSettings>>(settingsPath);
  } catch {
    return {};
  }
}

export async function getAiSettings(): Promise<AiServiceSettings> {
  const stored = await readStoredSettings();
  const defaults = getEnvDefaults();
  const openaiBaseUrl = clean(stored.openaiBaseUrl) || defaults.openaiBaseUrl;
  const minimaxBaseUrl = clean(stored.minimaxBaseUrl) || defaults.minimaxBaseUrl;

  return {
    textGenerationProvider: normalizeProvider(stored.textGenerationProvider, defaults.textGenerationProvider),
    videoImageProvider: normalizeProvider(stored.videoImageProvider, defaults.videoImageProvider),
    videoSpeechProvider: normalizeProvider(stored.videoSpeechProvider, defaults.videoSpeechProvider),
    openaiApiKey: clean(stored.openaiApiKey) || defaults.openaiApiKey,
    openaiBaseUrl,
    openaiTextBaseUrl: clean(stored.openaiTextBaseUrl) || defaults.openaiTextBaseUrl || openaiBaseUrl,
    openaiImageBaseUrl: clean(stored.openaiImageBaseUrl) || defaults.openaiImageBaseUrl || openaiBaseUrl,
    openaiTtsBaseUrl: clean(stored.openaiTtsBaseUrl) || defaults.openaiTtsBaseUrl || openaiBaseUrl,
    openaiTextModel: clean(stored.openaiTextModel) || defaults.openaiTextModel,
    openaiImageModel: clean(stored.openaiImageModel) || defaults.openaiImageModel,
    openaiTtsModel: clean(stored.openaiTtsModel) || defaults.openaiTtsModel,
    openaiTtsVoice: clean(stored.openaiTtsVoice) || defaults.openaiTtsVoice,
    openaiReasoningEffort: clean(stored.openaiReasoningEffort) || defaults.openaiReasoningEffort,
    openaiImageSize: clean(stored.openaiImageSize) || defaults.openaiImageSize,
    openaiImageQuality: clean(stored.openaiImageQuality) || defaults.openaiImageQuality,
    minimaxApiKey: clean(stored.minimaxApiKey) || defaults.minimaxApiKey,
    minimaxBaseUrl,
    minimaxTextBaseUrl: clean(stored.minimaxTextBaseUrl) || defaults.minimaxTextBaseUrl || minimaxBaseUrl,
    minimaxTextModel: clean(stored.minimaxTextModel) || defaults.minimaxTextModel,
    minimaxImageModel: clean(stored.minimaxImageModel) || defaults.minimaxImageModel,
    minimaxTtsModel: clean(stored.minimaxTtsModel) || defaults.minimaxTtsModel,
    updatedAt: clean(stored.updatedAt) || defaults.updatedAt
  };
}

export async function getSafeAiSettings() {
  const settings = await getAiSettings();
  return {
    ...settings,
    openaiApiKey: settings.openaiApiKey ? 'configured' : '',
    minimaxApiKey: settings.minimaxApiKey ? 'configured' : ''
  };
}

function setStringOverride<T extends keyof AiServiceSettings>(
  target: Partial<AiServiceSettings>,
  input: AiServiceSettingsInput,
  key: T
) {
  if (!(key in input)) return;
  const value = clean(input[key]);
  if (value) {
    target[key] = value as AiServiceSettings[T];
  } else {
    delete target[key];
  }
}

export async function updateAiSettings(input: AiServiceSettingsInput) {
  const next = await readStoredSettings();

  next.textGenerationProvider = normalizeProvider(input.textGenerationProvider, 'openai');
  next.videoImageProvider = normalizeProvider(input.videoImageProvider, 'openai');
  next.videoSpeechProvider = normalizeProvider(input.videoSpeechProvider, 'openai');

  const stringFields: Array<keyof AiServiceSettings> = [
    'openaiBaseUrl',
    'openaiTextBaseUrl',
    'openaiImageBaseUrl',
    'openaiTtsBaseUrl',
    'openaiTextModel',
    'openaiImageModel',
    'openaiTtsModel',
    'openaiTtsVoice',
    'openaiReasoningEffort',
    'openaiImageSize',
    'openaiImageQuality',
    'minimaxBaseUrl',
    'minimaxTextBaseUrl',
    'minimaxTextModel',
    'minimaxImageModel',
    'minimaxTtsModel'
  ];
  stringFields.forEach((key) => setStringOverride(next, input, key));

  if (input.clearOpenAiApiKey) {
    delete next.openaiApiKey;
  } else if (input.openaiApiKey && input.openaiApiKey !== 'configured') {
    next.openaiApiKey = input.openaiApiKey.trim();
  }

  if (input.clearMiniMaxApiKey) {
    delete next.minimaxApiKey;
  } else if (input.minimaxApiKey && input.minimaxApiKey !== 'configured') {
    next.minimaxApiKey = input.minimaxApiKey.trim();
  }

  next.updatedAt = nowIso();
  await writeJsonFile(settingsPath, next);
  return getAiSettings();
}
