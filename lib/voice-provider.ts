import { createHash } from 'crypto';
import { access, writeFile } from 'fs/promises';
import path from 'path';
import { ensureDirectory, nowIso } from './storage';
import { cloneVoiceWithCosyVoice, synthesizeLongSpeechWithCosyVoice } from './providers/cosyvoice';
import { cloneVoiceWithMiniMax, synthesizeConfiguredSpeechWithMiniMax } from './providers/minimax';
import { getSignedVoiceSampleUrl, uploadVoiceSampleToOss } from './providers/aliyun-oss';
import { getVoiceSettings } from './voice-settings';
import { getVoiceProfileById, getVoiceSampleAbsolutePath, readVoiceSampleBuffer, updateVoiceProfile } from './voice-profiles';
import { generatedRelativePath, publicPathFromRelative, resolveAppPath } from './runtime/paths';
import type { VoiceProfile } from './types';

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for custom voice generation`);
  return value;
}

function audioHash(text: string, profile: VoiceProfile) {
  const voiceVersion = profile.providerVoiceId || profile.updatedAt || profile.id;
  return createHash('sha1').update(`${profile.id}:${voiceVersion}:${text}`).digest('hex').slice(0, 12);
}

function arrayBufferToBuffer(value: ArrayBuffer) {
  return Buffer.from(new Uint8Array(value));
}

async function downloadToBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download generated audio: ${response.status}`);
  return arrayBufferToBuffer(await response.arrayBuffer());
}

async function fileExists(absolutePath: string) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function createProviderVoiceId(profile: VoiceProfile) {
  if (profile.providerVoiceId) return profile.providerVoiceId;

  if (profile.provider === 'aliyun-cosyvoice') {
    const settings = await getVoiceSettings();
    try {
      let sampleObjectKey = profile.sampleObjectKey;
      if (!sampleObjectKey) {
        const upload = await uploadVoiceSampleToOss({
          localAbsolutePath: getVoiceSampleAbsolutePath(profile),
          userId: profile.userId,
          profileId: profile.id,
          settings
        });
        sampleObjectKey = upload.objectKey;
        profile = await updateVoiceProfile({
          ...profile,
          sampleObjectKey,
          sampleStorageProvider: 'aliyun-oss',
          updatedAt: nowIso()
        });
      }
      const sampleUrl = getSignedVoiceSampleUrl({
        objectKey: sampleObjectKey,
        settings
      });
      const result = await cloneVoiceWithCosyVoice({
        profileId: profile.id,
        sampleUrl,
        settings
      });
      await updateVoiceProfile({
        ...profile,
        providerVoiceId: result.providerVoiceId,
        status: 'ready',
        lastError: undefined,
        updatedAt: nowIso()
      });
      return result.providerVoiceId;
    } catch (error) {
      await updateVoiceProfile({
        ...profile,
        status: 'failed',
        lastError: error instanceof Error ? error.message : 'CosyVoice voice clone failed',
        updatedAt: nowIso()
      });
      throw error;
    }
  }

  if (profile.provider === 'minimax') {
    const settings = await getVoiceSettings();
    const result = await cloneVoiceWithMiniMax({
      profileId: profile.id,
      sampleAbsolutePath: getVoiceSampleAbsolutePath(profile),
      fileName: `${profile.id}.wav`,
      settings
    });
    await updateVoiceProfile({
      ...profile,
      providerVoiceId: result.providerVoiceId,
      status: 'ready',
      lastError: undefined,
      updatedAt: nowIso()
    });
    return result.providerVoiceId;
  }

  const cloneEndpoint = process.env.VOICE_CLONE_ENDPOINT;
  if (!cloneEndpoint) {
    throw new Error('VOICE_CLONE_ENDPOINT is not configured; upload succeeded but voice cloning is not connected yet');
  }

  const sample = await readVoiceSampleBuffer(profile);
  const form = new FormData();
  form.append('name', profile.name);
  form.append('profileId', profile.id);
  form.append('sample', new Blob([sample]), 'sample.wav');

  const response = await fetch(cloneEndpoint, {
    method: 'POST',
    headers: process.env.VOICE_PROVIDER_API_KEY ? { Authorization: `Bearer ${process.env.VOICE_PROVIDER_API_KEY}` } : undefined,
    body: form
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Voice clone failed: ${response.status}`);
  }

  const providerVoiceId = payload?.voiceId || payload?.voice_id || payload?.id;
  if (!providerVoiceId) throw new Error('Voice clone response did not include voiceId');

  await updateVoiceProfile({
    ...profile,
    providerVoiceId,
    status: 'ready',
    lastError: undefined,
    updatedAt: nowIso()
  });

  return providerVoiceId as string;
}

export async function ensureVoiceProfileReady(profile: VoiceProfile) {
  const providerVoiceId = await createProviderVoiceId(profile);
  return await getVoiceProfileById(profile.id) || {
    ...profile,
    providerVoiceId,
    status: 'ready' as const,
    lastError: undefined,
    updatedAt: nowIso()
  };
}

async function synthesizeWithCustomHttp(params: {
  profile: VoiceProfile;
  text: string;
  outputAbsolutePath: string;
}) {
  const endpoint = requireEnv('VOICE_TTS_ENDPOINT');
  const voiceId = await createProviderVoiceId(params.profile);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.VOICE_PROVIDER_API_KEY ? { Authorization: `Bearer ${process.env.VOICE_PROVIDER_API_KEY}` } : {})
    },
    body: JSON.stringify({
      voiceId,
      voice_id: voiceId,
      text: params.text,
      format: 'mp3'
    })
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const payload = contentType.includes('application/json') ? await response.json() : null;
    throw new Error(payload?.error || payload?.message || `Voice synthesis failed: ${response.status}`);
  }

  let audioBuffer: Buffer;
  if (contentType.startsWith('audio/')) {
    audioBuffer = arrayBufferToBuffer(await response.arrayBuffer());
  } else {
    const payload = await response.json();
    if (payload.audioBase64 || payload.audio_base64) {
      audioBuffer = Buffer.from(payload.audioBase64 || payload.audio_base64, 'base64');
    } else if (payload.audioUrl || payload.audio_url || payload.url) {
      audioBuffer = await downloadToBuffer(payload.audioUrl || payload.audio_url || payload.url);
    } else {
      throw new Error('Voice synthesis response did not include audio data');
    }
  }

  await writeFile(params.outputAbsolutePath, audioBuffer);
}

async function synthesizeWithMiniMax(params: {
  profile: VoiceProfile;
  text: string;
  outputRelativePath: string;
}) {
  const settings = await getVoiceSettings();
  const voiceId = await createProviderVoiceId(params.profile);
  await synthesizeConfiguredSpeechWithMiniMax({
    text: params.text,
    outputRelativePath: params.outputRelativePath,
    voiceId,
    settings,
    format: 'mp3'
  });
}

async function synthesizeWithCosyVoice(params: {
  profile: VoiceProfile;
  text: string;
  outputRelativePath: string;
}) {
  const settings = await getVoiceSettings();
  const voiceId = await createProviderVoiceId(params.profile);
  await synthesizeLongSpeechWithCosyVoice({
    text: params.text,
    outputRelativePath: params.outputRelativePath,
    voiceId,
    settings
  });
}

export async function generateSceneVoiceAudio(params: {
  profile: VoiceProfile;
  projectId: string;
  sceneId: string;
  order: number;
  text: string;
}) {
  const hash = audioHash(params.text, params.profile);
  const extension = params.profile.provider === 'aliyun-cosyvoice' ? 'wav' : 'mp3';
  const relativePath = generatedRelativePath('remotion', params.projectId, 'audio', `${String(params.order).padStart(2, '0')}-${params.sceneId}-${hash}.${extension}`);
  const absolutePath = resolveAppPath(relativePath);
  await ensureDirectory(path.dirname(absolutePath));

  if (await fileExists(absolutePath)) {
    return {
      relativePath,
      absolutePath,
      publicPath: publicPathFromRelative(relativePath)
    };
  }

  if (params.profile.provider === 'aliyun-cosyvoice') {
    await synthesizeWithCosyVoice({
      profile: params.profile,
      text: params.text,
      outputRelativePath: relativePath
    });
  } else if (params.profile.provider === 'minimax') {
    await synthesizeWithMiniMax({
      profile: params.profile,
      text: params.text,
      outputRelativePath: relativePath
    });
  } else {
    await synthesizeWithCustomHttp({
      profile: params.profile,
      text: params.text,
      outputAbsolutePath: absolutePath
    });
  }

  return {
    relativePath,
    absolutePath,
    publicPath: publicPathFromRelative(relativePath)
  };
}
