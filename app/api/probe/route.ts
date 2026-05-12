import { NextResponse } from 'next/server';
import { getSafeAiSettings } from '@/lib/ai-settings';
import { getVideoRuntimeStatus } from '@/lib/queries';

export async function GET() {
  const [runtimeStatus, aiSettings] = await Promise.all([
    getVideoRuntimeStatus(),
    getSafeAiSettings()
  ]);

  return NextResponse.json({
    ok: true,
    source: 'probe-route',
    timestamp: new Date().toISOString(),
    runtime: runtimeStatus,
    ai: {
      textGenerationProvider: aiSettings.textGenerationProvider,
      videoImageProvider: aiSettings.videoImageProvider,
      videoSpeechProvider: aiSettings.videoSpeechProvider,
      openaiConfigured: Boolean(aiSettings.openaiApiKey),
      openaiBaseUrl: aiSettings.openaiBaseUrl,
      openaiTextModel: aiSettings.openaiTextModel,
      minimaxConfigured: Boolean(aiSettings.minimaxApiKey),
      minimaxBaseUrl: aiSettings.minimaxBaseUrl,
      minimaxTextModel: aiSettings.minimaxTextModel
    }
  });
}
