import path from 'path';
import { writeFile } from 'fs/promises';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { ensureDirectory } from '@/lib/storage';
import { publicPathFromRelative, resolveAppPath } from '@/lib/runtime/paths';

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_PROXY_AGENT = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY
  ? new EnvHttpProxyAgent()
  : undefined;
const OPENAI_REQUEST_TIMEOUT_MS = 1_800_000;

type OpenAIStatusPhase = 'attempting' | 'waiting' | 'retrying' | 'responded' | 'streaming' | 'completed';

export interface OpenAITextOptions {
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
  onStatus?: (status: {
    phase: OpenAIStatusPhase;
    attempt: number;
    maxAttempts: number;
    timeoutMs: number;
    elapsedMs: number;
    detail: string;
    previewText?: string;
    streamText?: string;
  }) => void | Promise<void>;
}

export interface OpenAIImageOptions {
  prompt: string;
  outputRelativePath: string;
  model?: string;
  size?: string;
  quality?: string;
  width?: number;
  height?: number;
  timeoutMs?: number;
}

export interface OpenAISpeechOptions {
  text: string;
  outputRelativePath: string;
  model?: string;
  voice?: string;
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  instructions?: string;
  speed?: number;
  timeoutMs?: number;
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

function isRetriableOpenAITextError(error: unknown) {
  const message = describeError(error);
  return /Timed out after \d+ms/i.test(message)
    || /fetch failed/i.test(message)
    || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|UND_ERR/i.test(message);
}

function isRetriableOpenAIStatus(status: number) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

async function fetchWithOpenAIDiagnostics(url: string, init: RequestInit, context: string, timeoutMs = OPENAI_REQUEST_TIMEOUT_MS, externalSignal?: AbortSignal) {
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
      dispatcher: OPENAI_PROXY_AGENT
    } as any);
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = typeof controller.signal.reason === 'string' ? controller.signal.reason : 'Request aborted';
      throw new Error(reason);
    }
    throw new Error(`OpenAI network request failed during ${context}: ${describeError(error)}; url=${url}`);
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternalSignal);
  }
}

function getOpenAIHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

function buildOpenAIUrl(baseUrl: string, endpoint: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (normalizedBaseUrl.endsWith('/v1') && normalizedEndpoint.startsWith('/v1/')) {
    return `${normalizedBaseUrl}${normalizedEndpoint.slice('/v1'.length)}`;
  }
  return `${normalizedBaseUrl}${normalizedEndpoint}`;
}

function getOpenAIBaseUrl(kind: 'text' | 'image' | 'speech') {
  if (kind === 'text') return process.env.OPENAI_TEXT_BASE_URL || process.env.OPENAI_BASE_URL || OPENAI_BASE_URL;
  if (kind === 'image') return process.env.OPENAI_IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || OPENAI_BASE_URL;
  return process.env.OPENAI_TTS_BASE_URL || process.env.OPENAI_SPEECH_BASE_URL || process.env.OPENAI_BASE_URL || OPENAI_BASE_URL;
}

function getAbsolutePath(relativePath: string) {
  return resolveAppPath(relativePath);
}

async function writeBinaryFile(relativePath: string, buffer: Buffer) {
  const absolutePath = getAbsolutePath(relativePath);
  await ensureDirectory(path.dirname(absolutePath));
  await writeFile(absolutePath, buffer);
}

async function downloadToFile(url: string, outputRelativePath: string) {
  const response = await fetchWithOpenAIDiagnostics(url, {}, 'downloading OpenAI generated asset', Number(process.env.OPENAI_DOWNLOAD_TIMEOUT_MS || 120_000));
  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    throw new Error(`Failed to download OpenAI generated asset: ${response.status} ${rawText.slice(0, 500)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeBinaryFile(outputRelativePath, Buffer.from(arrayBuffer));
}

function inferOpenAIImageSize(width?: number, height?: number) {
  if (process.env.OPENAI_IMAGE_SIZE) return process.env.OPENAI_IMAGE_SIZE;
  const w = width || 1080;
  const h = height || 1920;
  if (w === h) return '1024x1024';
  return w > h ? '1536x1024' : '1024x1536';
}

function extractImagePayload(payload: any) {
  const item = payload?.data?.[0] || payload?.images?.[0] || payload?.output?.[0];
  return {
    base64: item?.b64_json || item?.image_base64 || item?.base64 || payload?.b64_json,
    url: item?.url || item?.image_url || payload?.url || payload?.image_url
  };
}

function flattenOutputText(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => flattenOutputText(item));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.text === 'string') parts.push(record.text);
    if (typeof record.value === 'string') parts.push(record.value);
    if (typeof record.content === 'string') parts.push(record.content);
    if (Array.isArray(record.content)) parts.push(...flattenOutputText(record.content));
    if (Array.isArray(record.output)) parts.push(...flattenOutputText(record.output));
    return parts;
  }
  return [];
}

function extractTextResponse(payload: any): string | null {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const fromOutput = flattenOutputText(payload?.output).join('');
  if (fromOutput) return fromOutput;
  const fromChoices = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text;
  return typeof fromChoices === 'string' && fromChoices ? fromChoices : null;
}

function extractStreamText(payload: any): string {
  const delta = payload?.delta;
  if (typeof delta === 'string') return delta;
  const text = payload?.text || payload?.output_text || payload?.content;
  if (typeof text === 'string') return text;
  return flattenOutputText(payload?.output).join('');
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

function buildRequestBody(options: OpenAITextOptions) {
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || 'none';
  const body: Record<string, unknown> = {
    model: options.model || process.env.OPENAI_TEXT_MODEL || 'gpt-5.4',
    instructions: options.systemPrompt,
    input: options.userPrompt,
    max_output_tokens: options.maxTokens || 4096,
    stream: options.stream ?? false
  };

  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }
  if (options.temperature !== undefined && reasoningEffort === 'none') {
    body.temperature = options.temperature;
  }

  return body;
}

export function isOpenAITextConfigured() {
  return Boolean(OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

export async function generateTextWithOpenAI(options: OpenAITextOptions) {
  const apiKey = process.env.OPENAI_API_KEY || OPENAI_API_KEY;
  if (!apiKey) return null;

  const endpoint = '/v1/responses';
  const baseUrl = getOpenAIBaseUrl('text');
  const requestUrl = buildOpenAIUrl(baseUrl, endpoint);
  const requestBody = buildRequestBody(options);
  const timeoutMs = options.timeoutMs ?? Number(process.env.OPENAI_TEXT_TIMEOUT_MS || OPENAI_REQUEST_TIMEOUT_MS);
  const maxRetries = Math.max(0, options.maxRetries ?? Number(process.env.OPENAI_TEXT_MAX_RETRIES || 2));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? Number(process.env.OPENAI_TEXT_RETRY_DELAY_MS || 2500));
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
        detail: `正在请求 OpenAI，第 ${attemptNumber}/${maxAttempts} 次尝试。`,
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
            detail: `OpenAI 正在生成文本，当前第 ${attemptNumber}/${maxAttempts} 次尝试，已等待 ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} 秒。`
          });
        }, 1000)
        : null;

      const response = await fetchWithOpenAIDiagnostics(
        requestUrl,
        {
          method: 'POST',
          headers: getOpenAIHeaders(apiKey),
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
        const error = new Error(`OpenAI text generation failed at ${endpoint}: ${response.status} ${rawText}`);
        if (attempt < maxRetries && isRetriableOpenAIStatus(response.status)) {
          lastError = error;
          await options.onStatus?.({
            phase: 'retrying',
            attempt: attemptNumber,
            maxAttempts,
            timeoutMs,
            elapsedMs: Date.now() - startedAt,
            detail: `OpenAI 返回 ${response.status}，${retryDelayMs * (attempt + 1) / 1000} 秒后重试。`,
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
            detail: 'OpenAI 正在流式返回文本...',
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
            const nextText = extractStreamText(payload);
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
                detail: 'OpenAI 已开始返回流式文本。',
                previewText: accumulatedText.slice(0, 160),
                streamText: accumulatedText
              });
            }

            await emitStreamUpdate();
          }

          if (done) break;
        }

        if (!accumulatedText && lastPayload) {
          accumulatedText = extractTextResponse(lastPayload) || '';
        }
        if (!accumulatedText) {
          throw new Error(`OpenAI text stream did not contain content at ${endpoint}`);
        }

        await emitStreamUpdate(true);
        await options.onStatus?.({
          phase: 'completed',
          attempt: attemptNumber,
          maxAttempts,
          timeoutMs,
          elapsedMs: Date.now() - startedAt,
          detail: 'OpenAI 文本已生成完成，正在进入结构校验。',
          previewText: accumulatedText.slice(0, 160),
          streamText: accumulatedText
        });

        return {
          text: accumulatedText,
          endpoint,
          model: String(requestBody.model)
        };
      }

      const rawText = await response.text();
      await options.onStatus?.({
        phase: 'responded',
        attempt: attemptNumber,
        maxAttempts,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        detail: 'OpenAI 已返回响应，正在解析结果。',
        previewText: rawText.slice(0, 160)
      });

      let payload: any;
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error(`OpenAI response is not valid JSON at ${endpoint}: ${rawText.slice(0, 1000)}`);
      }

      const text = extractTextResponse(payload);
      if (!text) {
        throw new Error(`OpenAI text response did not contain content at ${endpoint}: ${rawText.slice(0, 1200)}`);
      }

      await options.onStatus?.({
        phase: 'completed',
        attempt: attemptNumber,
        maxAttempts,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        detail: 'OpenAI 文本已生成完成，正在进入结构校验。',
        previewText: text.slice(0, 160),
        streamText: text
      });

      return {
        text,
        endpoint,
        model: String(requestBody.model)
      };
    } catch (error) {
      if (heartbeat) clearInterval(heartbeat);
      const wrapped = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries && isRetriableOpenAITextError(wrapped)) {
        lastError = wrapped;
        await options.onStatus?.({
          phase: 'retrying',
          attempt: attemptNumber,
          maxAttempts,
          timeoutMs,
          elapsedMs: 0,
          detail: `OpenAI 请求异常：${wrapped.message}。${retryDelayMs * (attempt + 1) / 1000} 秒后重试。`,
          streamText: ''
        });
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw wrapped;
    }
  }

  throw lastError || new Error(`OpenAI text generation failed after ${maxRetries + 1} attempts at ${endpoint}`);
}
export function isOpenAIImageConfigured() {
  return Boolean(OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

export function isOpenAISpeechConfigured() {
  return Boolean(OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

export async function generateImageWithOpenAI(options: OpenAIImageOptions) {
  const apiKey = process.env.OPENAI_API_KEY || OPENAI_API_KEY;
  if (!apiKey) return null;

  const endpoint = '/v1/images/generations';
  const baseUrl = getOpenAIBaseUrl('image');
  const requestUrl = buildOpenAIUrl(baseUrl, endpoint);
  const requestBody: Record<string, unknown> = {
    model: options.model || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    prompt: options.prompt,
    size: options.size || inferOpenAIImageSize(options.width, options.height)
  };
  const quality = options.quality || process.env.OPENAI_IMAGE_QUALITY;
  if (quality) requestBody.quality = quality;

  const response = await fetchWithOpenAIDiagnostics(
    requestUrl,
    {
      method: 'POST',
      headers: getOpenAIHeaders(apiKey),
      body: JSON.stringify(requestBody)
    },
    `image generation request at ${endpoint}`,
    options.timeoutMs ?? Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 300_000)
  );

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI image generation failed at ${endpoint}: ${response.status} ${rawText}`);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error(`OpenAI image response is not valid JSON at ${endpoint}: ${rawText.slice(0, 1000)}`);
  }

  const image = extractImagePayload(payload);
  if (typeof image.base64 === 'string' && image.base64) {
    const encoded = image.base64.includes(',') ? image.base64.split(',').pop() || image.base64 : image.base64;
    await writeBinaryFile(options.outputRelativePath, Buffer.from(encoded, 'base64'));
  } else if (typeof image.url === 'string' && image.url) {
    await downloadToFile(image.url, options.outputRelativePath);
  } else {
    throw new Error(`OpenAI image response did not contain image data at ${endpoint}: ${rawText.slice(0, 1200)}`);
  }

  return {
    relativePath: options.outputRelativePath,
    publicPath: publicPathFromRelative(options.outputRelativePath),
    endpoint,
    model: String(requestBody.model),
    size: String(requestBody.size)
  };
}

export async function synthesizeSpeechWithOpenAI(options: OpenAISpeechOptions) {
  const apiKey = process.env.OPENAI_API_KEY || OPENAI_API_KEY;
  if (!apiKey) return null;

  const endpoint = '/v1/audio/speech';
  const baseUrl = getOpenAIBaseUrl('speech');
  const requestUrl = buildOpenAIUrl(baseUrl, endpoint);
  const requestBody: Record<string, unknown> = {
    model: options.model || process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: options.voice || process.env.OPENAI_TTS_VOICE || 'alloy',
    input: options.text,
    response_format: options.format || 'mp3'
  };
  if (options.instructions || process.env.OPENAI_TTS_INSTRUCTIONS) {
    requestBody.instructions = options.instructions || process.env.OPENAI_TTS_INSTRUCTIONS;
  }
  if (typeof options.speed === 'number') {
    requestBody.speed = options.speed;
  }

  const response = await fetchWithOpenAIDiagnostics(
    requestUrl,
    {
      method: 'POST',
      headers: getOpenAIHeaders(apiKey),
      body: JSON.stringify(requestBody)
    },
    `speech synthesis request at ${endpoint}`,
    options.timeoutMs ?? Number(process.env.OPENAI_TTS_TIMEOUT_MS || 120_000)
  );

  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    throw new Error(`OpenAI speech synthesis failed at ${endpoint}: ${response.status} ${rawText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeBinaryFile(options.outputRelativePath, Buffer.from(arrayBuffer));

  return {
    relativePath: options.outputRelativePath,
    publicPath: publicPathFromRelative(options.outputRelativePath),
    endpoint,
    model: String(requestBody.model),
    voice: String(requestBody.voice)
  };
}

