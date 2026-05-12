import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { getAiSettings, type AiServiceSettings } from '@/lib/ai-settings';
import { ensureDirectory } from '@/lib/storage';
import { publicPathFromRelative, resolveAppPath } from '@/lib/runtime/paths';
import type { VoiceSettings } from '@/lib/types';
import { getVoiceSettings } from '@/lib/voice-settings';

const MINIMAX_BASE_URL = process.env.MINIMAX_API_HOST || process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com';
const MINIMAX_TEXT_BASE_URL = process.env.MINIMAX_TEXT_BASE_URL || process.env.MINIMAX_API_HOST || process.env.MINIMAX_BASE_URL || 'https://api.minimax.io';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINI_MAX_PROXY_AGENT = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY
  ? new EnvHttpProxyAgent()
  : undefined;
const MINIMAX_REQUEST_TIMEOUT_MS = 45000;
const MINIMAX_DOWNLOAD_TIMEOUT_MS = 45000;

interface MiniMaxImageOptions {
  prompt: string;
  outputRelativePath: string;
  model?: string;
  width?: number;
  height?: number;
}

interface MiniMaxSpeechOptions {
  text: string;
  outputRelativePath: string;
  model?: string;
  voiceId?: string;
  format?: 'mp3' | 'wav' | 'flac' | 'pcm';
}

interface MiniMaxVoiceCloneOptions {
  profileId: string;
  sampleAbsolutePath: string;
  fileName: string;
  settings: VoiceSettings;
}

interface MiniMaxConfiguredSpeechOptions {
  text: string;
  outputRelativePath: string;
  voiceId: string;
  settings: VoiceSettings;
  format?: 'mp3' | 'wav' | 'flac' | 'pcm';
}

interface MiniMaxTextOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  settings?: VoiceSettings;
  onStatus?: (status: {
    phase: 'attempting' | 'waiting' | 'retrying' | 'responded' | 'streaming' | 'completed';
    attempt: number;
    maxAttempts: number;
    timeoutMs: number;
    elapsedMs: number;
    detail: string;
    previewText?: string;
    streamText?: string;
  }) => void | Promise<void>;
}

function pickConfigValue<T>(primary: T | undefined, secondary: T | undefined, fallback: T) {
  return primary || secondary || fallback;
}

function getMiniMaxConfig(settings?: VoiceSettings, aiSettings?: AiServiceSettings, preferVoiceSettings = true) {
  const first = preferVoiceSettings ? settings : undefined;
  const second = preferVoiceSettings ? undefined : settings;
  return {
    apiKey: pickConfigValue(first?.minimaxApiKey, aiSettings?.minimaxApiKey || second?.minimaxApiKey, MINIMAX_API_KEY),
    baseUrl: pickConfigValue(first?.minimaxBaseUrl, aiSettings?.minimaxBaseUrl || second?.minimaxBaseUrl, MINIMAX_BASE_URL),
    ttsModel: pickConfigValue(first?.minimaxTtsModel, aiSettings?.minimaxTtsModel || second?.minimaxTtsModel, process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd'),
    cloneModel: first?.minimaxCloneModel
      || first?.minimaxTtsModel
      || second?.minimaxCloneModel
      || second?.minimaxTtsModel
      || process.env.MINIMAX_VOICE_CLONE_MODEL
      || process.env.MINIMAX_TTS_MODEL
      || 'speech-2.8-hd',
    languageBoost: first?.minimaxLanguageBoost || second?.minimaxLanguageBoost || 'Chinese',
    voicePrefix: first?.minimaxVoicePrefix || second?.minimaxVoicePrefix || 'VideoFactory'
  };
}

function getAuthHeaders(settings?: VoiceSettings, aiSettings?: AiServiceSettings, preferVoiceSettings = true) {
  const config = getMiniMaxConfig(settings, aiSettings, preferVoiceSettings);
  if (!config.apiKey) {
    throw new Error('MINIMAX_API_KEY is not configured');
  }

  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'MM-API-Source': 'Video-Factory'
  };
}

function getMultipartAuthHeaders(settings?: VoiceSettings, aiSettings?: AiServiceSettings, preferVoiceSettings = true) {
  const config = getMiniMaxConfig(settings, aiSettings, preferVoiceSettings);
  if (!config.apiKey) {
    throw new Error('MINIMAX_API_KEY is not configured');
  }

  return {
    Authorization: `Bearer ${config.apiKey}`,
    'MM-API-Source': 'Video-Factory'
  };
}

function getAbsolutePath(relativePath: string) {
  return resolveAppPath(relativePath);
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `; cause: ${error.cause.message}` : '';
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableMiniMaxTextError(error: unknown) {
  const message = describeError(error);
  return /Timed out after \d+ms/i.test(message)
    || /fetch failed/i.test(message)
    || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|UND_ERR/i.test(message);
}

function isRetriableMiniMaxStatus(status: number) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

async function fetchWithMiniMaxDiagnostics(url: string, init: RequestInit, context: string, timeoutMs = MINIMAX_REQUEST_TIMEOUT_MS, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason || 'Request aborted');
  const timeout = setTimeout(() => controller.abort(`Timed out after ${timeoutMs}ms`), timeoutMs);
  if (externalSignal?.aborted) {
    abortFromExternalSignal();
  } else if (externalSignal) {
    externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
  }

  try {
    return await undiciFetch(url, {
      ...init,
      signal: controller.signal,
      dispatcher: MINI_MAX_PROXY_AGENT
    } as any);
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = typeof controller.signal.reason === 'string' ? controller.signal.reason : 'Request aborted';
      throw new Error(reason);
    }
    throw new Error(`MiniMax network request failed during ${context}: ${describeError(error)}; url=${url}`);
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternalSignal);
  }
}

async function writeBinaryFile(relativePath: string, buffer: Buffer) {
  const absolutePath = getAbsolutePath(relativePath);
  await ensureDirectory(path.dirname(absolutePath));
  await writeFile(absolutePath, buffer);
}

async function downloadToFile(url: string, outputRelativePath: string) {
  const response = await fetchWithMiniMaxDiagnostics(url, {}, 'downloading generated asset', MINIMAX_DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    throw new Error(`Failed to download generated asset: ${response.status} ${rawText.slice(0, 500)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeBinaryFile(outputRelativePath, Buffer.from(arrayBuffer));
}

function extractImageUrl(payload: any): string | null {
  return payload?.data?.image_urls?.[0]
    || payload?.data?.images?.[0]?.url
    || payload?.data?.image_url
    || payload?.images?.[0]?.url
    || payload?.images?.[0]
    || payload?.output?.images?.[0]?.url
    || payload?.output?.images?.[0]
    || payload?.output?.[0]?.url
    || payload?.output?.[0]
    || payload?.url
    || null;
}

function extractAudioUrl(payload: any): string | null {
  return payload?.data?.audio_url
    || payload?.data?.url
    || payload?.audio_url
    || payload?.url
    || null;
}

function extractAudioHex(payload: any): string | null {
  return payload?.data?.audio
    || payload?.audio
    || null;
}

function extractFileId(payload: any): string | null {
  return payload?.file?.file_id
    || payload?.file_id
    || payload?.data?.file_id
    || payload?.data?.file?.file_id
    || payload?.id
    || null;
}

function inferAspectRatio(width?: number, height?: number) {
  const w = width || 1080;
  const h = height || 1920;

  if (w === h) return '1:1';
  if (Math.abs(w / h - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(w / h - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(w / h - 4 / 3) < 0.02) return '4:3';
  if (Math.abs(w / h - 3 / 4) < 0.02) return '3:4';

  return w > h ? '16:9' : '9:16';
}

function ensureJsonPayload(rawText: string, endpoint: string) {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`MiniMax response is not valid JSON at ${endpoint}: ${rawText.slice(0, 1000)}`);
  }
}

function ensureMiniMaxBaseResp(payload: any, endpoint: string) {
  const baseResp = payload?.base_resp;
  if (baseResp && baseResp.status_code !== 0) {
    throw new Error(`MiniMax request failed at ${endpoint}: ${baseResp.status_code} ${baseResp.status_msg || 'Unknown error'}`);
  }
}

export async function isMiniMaxConfigured() {
  const aiSettings = await getAiSettings();
  if (aiSettings.minimaxApiKey) return true;
  try {
    const settings = await getVoiceSettings();
    return Boolean(settings.minimaxApiKey);
  } catch {
    return Boolean(MINIMAX_API_KEY);
  }
}

export async function isMiniMaxTextConfigured() {
  const aiSettings = await getAiSettings();
  if (aiSettings.minimaxApiKey) return true;
  try {
    const settings = await getVoiceSettings();
    return Boolean(settings.minimaxApiKey);
  } catch {
    return false;
  }
}

function extractTextResponse(payload: any): string | null {
  return payload?.choices?.[0]?.message?.content
    || payload?.choices?.[0]?.text
    || payload?.reply
    || payload?.data?.text
    || payload?.output_text
    || payload?.text
    || null;
}

function flattenStreamText(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStreamText(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return [record.text];
    if (typeof record.content === 'string') return [record.content];
    if (typeof record.reasoning_content === 'string') return [record.reasoning_content];
  }
  return [];
}

function extractStreamChunkText(payload: any): string {
  const choice = payload?.choices?.[0];
  const parts = [
    ...flattenStreamText(choice?.delta?.content),
    ...flattenStreamText(choice?.delta?.reasoning_content),
    ...flattenStreamText(choice?.message?.content),
    ...flattenStreamText(choice?.message?.reasoning_content),
    ...flattenStreamText(choice?.text),
    ...flattenStreamText(payload?.data?.text)
  ];
  return parts.join('');
}

function mergeStreamText(current: string, incoming: string) {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.endsWith(incoming)) return current;

  const maxOverlap = Math.min(current.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (current.endsWith(incoming.slice(0, overlap))) {
      return current + incoming.slice(overlap);
    }
  }

  return current + incoming;
}

function pullNextSseEvent(buffer: string) {
  const match = buffer.match(/\r?\n\r?\n/);
  if (!match || typeof match.index !== 'number') return null;
  return {
    event: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length)
  };
}

export async function generateTextWithMiniMax(options: MiniMaxTextOptions) {
  const aiSettings = await getAiSettings();
  const settings = options.settings || await getVoiceSettings().catch(() => undefined);
  const config = getMiniMaxConfig(settings, aiSettings, false);
  const apiKey = config.apiKey;
  if (!apiKey) return null;

  const endpoint = '/v1/text/chatcompletion_v2';
  const textBaseUrl = aiSettings.minimaxTextBaseUrl || config.baseUrl || MINIMAX_TEXT_BASE_URL;
  const requestBody = {
    model: options.model || aiSettings.minimaxTextModel,
    messages: [
      {
        role: 'system',
        content: options.systemPrompt
      },
      {
        role: 'user',
        content: options.userPrompt
      }
    ],
    temperature: options.temperature ?? 0.35,
    max_tokens: options.maxTokens || 4096,
    stream: options.stream ?? false
  };
  const timeoutMs = options.timeoutMs ?? Number(process.env.MINIMAX_TEXT_TIMEOUT_MS || 1_800_000);
  const maxRetries = Math.max(0, options.maxRetries ?? Number(process.env.MINIMAX_TEXT_MAX_RETRIES || 2));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? Number(process.env.MINIMAX_TEXT_RETRY_DELAY_MS || 2500));
  const maxAttempts = maxRetries + 1;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const attemptNumber = attempt + 1;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      await options.onStatus?.({
        phase: 'attempting',
        attempt: attemptNumber,
        maxAttempts,
        timeoutMs,
        elapsedMs: 0,
        detail: `正在请求 MiniMax，第 ${attemptNumber}/${maxAttempts} 次尝试。`,
        streamText: ''
      });

      const startedAt = Date.now();
      heartbeat = options.onStatus
        ? setInterval(() => {
          void options.onStatus?.({
            phase: 'waiting',
            attempt: attemptNumber,
            maxAttempts,
            timeoutMs,
            elapsedMs: Date.now() - startedAt,
            detail: `MiniMax 正在生成文本，当前第 ${attemptNumber}/${maxAttempts} 次尝试，已等待 ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} 秒。`
          });
        }, 1000)
        : null;

      const response = await fetchWithMiniMaxDiagnostics(
        `${textBaseUrl}${endpoint}`,
        {
          method: 'POST',
          headers: getAuthHeaders(settings, aiSettings, false),
          body: JSON.stringify(requestBody)
        },
        `text generation request at ${endpoint}`,
        timeoutMs,
        options.signal
      );
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      if (!response.ok) {
        const rawText = await response.text();
        const error = new Error(`MiniMax text generation failed at ${endpoint}: ${response.status} ${rawText}`);
        if (attempt < maxRetries && isRetriableMiniMaxStatus(response.status)) {
          lastError = error;
          await options.onStatus?.({
            phase: 'retrying',
            attempt: attemptNumber,
            maxAttempts,
            timeoutMs,
            elapsedMs: Date.now() - startedAt,
            detail: `MiniMax 返回 ${response.status}，${retryDelayMs * (attempt + 1) / 1000} 秒后重试。`,
            streamText: ''
          });
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw error;
      }

      if (requestBody.stream && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastPayload: any = null;
        let accumulatedText = '';
        let lastEmittedText = '';
        let lastStreamEmitAt = 0;
        let emittedResponse = false;

        const emitStreamUpdate = async (force = false) => {
          if (!options.onStatus || !accumulatedText || accumulatedText === lastEmittedText) return;
          const now = Date.now();
          if (!force && now - lastStreamEmitAt < 200 && accumulatedText.length - lastEmittedText.length < 48) return;
          lastEmittedText = accumulatedText;
          lastStreamEmitAt = now;
          await options.onStatus({
            phase: 'streaming',
            attempt: attemptNumber,
            maxAttempts,
            timeoutMs,
            elapsedMs: now - startedAt,
            detail: 'MiniMax 正在流式返回文本...',
            previewText: accumulatedText.slice(-240),
            streamText: accumulatedText
          });
        };

        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

          while (true) {
            const nextEvent = pullNextSseEvent(buffer);
            if (!nextEvent) break;
            buffer = nextEvent.rest;
            const data = nextEvent.event
              .split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n')
              .trim();

            if (!data || data === '[DONE]') continue;

            let payload: any;
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }

            lastPayload = payload;
            const nextText = extractStreamChunkText(payload);
            if (!nextText) continue;
            accumulatedText = mergeStreamText(accumulatedText, nextText);

            if (!emittedResponse) {
              emittedResponse = true;
              await options.onStatus?.({
                phase: 'responded',
                attempt: attemptNumber,
                maxAttempts,
                timeoutMs,
                elapsedMs: Date.now() - startedAt,
                detail: 'MiniMax 已开始返回流式文本。',
                previewText: accumulatedText.slice(0, 160),
                streamText: accumulatedText
              });
            }

            await emitStreamUpdate();
          }

          if (done) break;
        }

        if (!lastPayload && buffer.trim()) {
          try {
            lastPayload = JSON.parse(buffer.trim());
          } catch {
            lastPayload = null;
          }
        }

        if (lastPayload) {
          ensureMiniMaxBaseResp(lastPayload, endpoint);
        }

        if (!accumulatedText && lastPayload) {
          accumulatedText = extractTextResponse(lastPayload) || '';
        }
        if (!accumulatedText) {
          throw new Error(`MiniMax text stream did not contain content at ${endpoint}`);
        }

        await emitStreamUpdate(true);
        await options.onStatus?.({
          phase: 'completed',
          attempt: attemptNumber,
          maxAttempts,
          timeoutMs,
          elapsedMs: Date.now() - startedAt,
          detail: 'MiniMax 文本已生成完成，正在进入结构校验。',
          previewText: accumulatedText.slice(0, 160),
          streamText: accumulatedText
        });

        return {
          text: accumulatedText,
          endpoint,
          model: requestBody.model
        };
      }

      const rawText = await response.text();
      await options.onStatus?.({
        phase: 'responded',
        attempt: attemptNumber,
        maxAttempts,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        detail: 'MiniMax 已返回响应，正在解析结果。',
        previewText: rawText.slice(0, 160)
      });

      const payload = ensureJsonPayload(rawText, endpoint);
      ensureMiniMaxBaseResp(payload, endpoint);

      const text = extractTextResponse(payload);
      if (!text) {
        throw new Error(`MiniMax text response did not contain content at ${endpoint}: ${rawText.slice(0, 1200)}`);
      }

      await options.onStatus?.({
        phase: 'completed',
        attempt: attemptNumber,
        maxAttempts,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        detail: 'MiniMax 文本已生成完成，正在进入结构校验。',
        previewText: text.slice(0, 160),
        streamText: text
      });

      return {
        text,
        endpoint,
        model: requestBody.model
      };
    } catch (error) {
      if (heartbeat) clearInterval(heartbeat);
      const wrapped = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries && isRetriableMiniMaxTextError(wrapped)) {
        lastError = wrapped;
        await options.onStatus?.({
          phase: 'retrying',
          attempt: attemptNumber,
          maxAttempts,
          timeoutMs,
          elapsedMs: 0,
          detail: `MiniMax 请求异常：${wrapped.message}。${retryDelayMs * (attempt + 1) / 1000} 秒后重试。`,
          streamText: ''
        });
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw wrapped;
    }
  }

  throw lastError || new Error(`MiniMax text generation failed after ${maxRetries + 1} attempts at ${endpoint}`);
}

export async function generateImageWithMiniMax(options: MiniMaxImageOptions) {
  const [aiSettings, settings] = await Promise.all([
    getAiSettings(),
    getVoiceSettings().catch(() => undefined)
  ]);
  const config = getMiniMaxConfig(settings, aiSettings, false);
  if (!config.apiKey) return null;

  const endpoint = '/v1/image_generation';
  const requestBody = {
    model: options.model || aiSettings.minimaxImageModel,
    prompt: options.prompt,
    aspect_ratio: inferAspectRatio(options.width, options.height),
    n: 1,
    response_format: 'url',
    prompt_optimizer: true
  };

  const response = await fetchWithMiniMaxDiagnostics(
    `${config.baseUrl}${endpoint}`,
    {
      method: 'POST',
      headers: getAuthHeaders(settings, aiSettings, false),
      body: JSON.stringify(requestBody)
    },
    `image generation request at ${endpoint}`
  );

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`MiniMax image generation failed at ${endpoint}: ${response.status} ${rawText}`);
  }

  const payload = ensureJsonPayload(rawText, endpoint);
  ensureMiniMaxBaseResp(payload, endpoint);

  const imageUrl = extractImageUrl(payload);
  if (!imageUrl) {
    throw new Error(`MiniMax image response did not contain image_urls at ${endpoint}: ${rawText.slice(0, 1200)}`);
  }

  await downloadToFile(imageUrl, options.outputRelativePath);
  return {
    relativePath: options.outputRelativePath,
    publicPath: publicPathFromRelative(options.outputRelativePath),
    source: 'url' as const,
    endpoint
  };
}

export async function synthesizeSpeechWithMiniMax(options: MiniMaxSpeechOptions) {
  const [aiSettings, settings] = await Promise.all([
    getAiSettings(),
    getVoiceSettings().catch(() => undefined)
  ]);
  const config = getMiniMaxConfig(settings, aiSettings, false);
  if (!config.apiKey) return null;

  const endpoint = '/v1/t2a_v2';
  const response = await fetchWithMiniMaxDiagnostics(
    `${config.baseUrl}${endpoint}`,
    {
      method: 'POST',
      headers: getAuthHeaders(settings, aiSettings, false),
      body: JSON.stringify({
        model: options.model || config.ttsModel,
        text: options.text,
        stream: false,
        voice_setting: {
          voice_id: options.voiceId || process.env.MINIMAX_VOICE_ID || 'female-tianmei',
          speed: 1.0,
          pitch: 0,
          emotion: 'happy'
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: options.format || 'mp3'
        }
      })
    },
    `speech synthesis request at ${endpoint}`
  );

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`MiniMax speech synthesis failed at ${endpoint}: ${response.status} ${rawText}`);
  }

  const payload = ensureJsonPayload(rawText, endpoint);
  ensureMiniMaxBaseResp(payload, endpoint);

  const audioUrl = extractAudioUrl(payload);
  if (audioUrl) {
    await downloadToFile(audioUrl, options.outputRelativePath);
    return {
      relativePath: options.outputRelativePath,
      publicPath: publicPathFromRelative(options.outputRelativePath),
      source: 'url' as const,
      endpoint
    };
  }

  const audioHex = extractAudioHex(payload);
  if (!audioHex) {
    throw new Error(`MiniMax speech response did not contain audio payload at ${endpoint}: ${rawText.slice(0, 1200)}`);
  }

  await writeBinaryFile(options.outputRelativePath, Buffer.from(audioHex, 'hex'));
  return {
    relativePath: options.outputRelativePath,
    publicPath: publicPathFromRelative(options.outputRelativePath),
    source: 'hex' as const,
    endpoint
  };
}

export async function cloneVoiceWithMiniMax(options: MiniMaxVoiceCloneOptions) {
  const config = getMiniMaxConfig(options.settings);
  const uploadEndpoint = '/v1/files/upload';
  const cloneEndpoint = '/v1/voice_clone';
  const sample = await readFile(options.sampleAbsolutePath);
  const form = new FormData();
  form.append('purpose', 'voice_clone');
  form.append('file', new Blob([sample]), options.fileName || 'voice-sample.wav');

  const uploadResponse = await fetchWithMiniMaxDiagnostics(
    `${config.baseUrl}${uploadEndpoint}`,
    {
      method: 'POST',
      headers: getMultipartAuthHeaders(options.settings),
      body: form
    },
    `voice sample upload at ${uploadEndpoint}`,
    120000
  );

  const uploadRawText = await uploadResponse.text();
  if (!uploadResponse.ok) {
    throw new Error(`MiniMax voice sample upload failed at ${uploadEndpoint}: ${uploadResponse.status} ${uploadRawText}`);
  }

  const uploadPayload = ensureJsonPayload(uploadRawText, uploadEndpoint);
  ensureMiniMaxBaseResp(uploadPayload, uploadEndpoint);
  const fileId = extractFileId(uploadPayload);
  if (!fileId) {
    throw new Error(`MiniMax file upload response did not include file_id: ${uploadRawText.slice(0, 1200)}`);
  }

  const safeSuffix = options.profileId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-24);
  const voiceId = `${config.voicePrefix || 'VideoFactory'}_${safeSuffix}`;
  const cloneResponse = await fetchWithMiniMaxDiagnostics(
    `${config.baseUrl}${cloneEndpoint}`,
    {
      method: 'POST',
      headers: getAuthHeaders(options.settings),
      body: JSON.stringify({
        file_id: Number.isNaN(Number(fileId)) ? fileId : Number(fileId),
        voice_id: voiceId,
        model: config.cloneModel,
        need_noise_reduction: true
      })
    },
    `voice clone request at ${cloneEndpoint}`,
    120000
  );

  const cloneRawText = await cloneResponse.text();
  if (!cloneResponse.ok) {
    throw new Error(`MiniMax voice clone failed at ${cloneEndpoint}: ${cloneResponse.status} ${cloneRawText}`);
  }

  const clonePayload = ensureJsonPayload(cloneRawText, cloneEndpoint);
  ensureMiniMaxBaseResp(clonePayload, cloneEndpoint);

  return {
    providerVoiceId: clonePayload?.voice_id || clonePayload?.data?.voice_id || voiceId,
    fileId,
    endpoint: cloneEndpoint
  };
}

export async function synthesizeConfiguredSpeechWithMiniMax(options: MiniMaxConfiguredSpeechOptions) {
  const config = getMiniMaxConfig(options.settings);
  const endpoint = '/v1/t2a_v2';
  const response = await fetchWithMiniMaxDiagnostics(
    `${config.baseUrl}${endpoint}`,
    {
      method: 'POST',
      headers: getAuthHeaders(options.settings),
      body: JSON.stringify({
        model: config.ttsModel,
        text: options.text,
        stream: false,
        voice_setting: {
          voice_id: options.voiceId,
          speed: 1.0,
          pitch: 0,
          vol: 1.0
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: options.format || 'mp3',
          channel: 1
        },
        language_boost: config.languageBoost,
        output_format: 'hex'
      })
    },
    `configured speech synthesis request at ${endpoint}`,
    120000
  );

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`MiniMax configured speech synthesis failed at ${endpoint}: ${response.status} ${rawText}`);
  }

  const payload = ensureJsonPayload(rawText, endpoint);
  ensureMiniMaxBaseResp(payload, endpoint);

  const audioUrl = extractAudioUrl(payload);
  if (audioUrl) {
    await downloadToFile(audioUrl, options.outputRelativePath);
    return {
      relativePath: options.outputRelativePath,
      publicPath: publicPathFromRelative(options.outputRelativePath),
      source: 'url' as const,
      endpoint
    };
  }

  const audioHex = extractAudioHex(payload);
  if (!audioHex) {
    throw new Error(`MiniMax configured speech response did not contain audio payload at ${endpoint}: ${rawText.slice(0, 1200)}`);
  }

  await writeBinaryFile(options.outputRelativePath, Buffer.from(audioHex, 'hex'));
  return {
    relativePath: options.outputRelativePath,
    publicPath: publicPathFromRelative(options.outputRelativePath),
    source: 'hex' as const,
    endpoint
  };
}
