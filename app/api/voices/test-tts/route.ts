import { NextResponse } from 'next/server';
import { getAudioDurationSec } from '@/lib/audio-metadata';
import { requireApiRole } from '@/lib/api-auth';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { creditErrorStatus } from '@/lib/render-credit';
import { synthesizeLongSpeechWithCosyVoice } from '@/lib/providers/cosyvoice';
import { synthesizeConfiguredSpeechWithMiniMax } from '@/lib/providers/minimax';
import { generatedRelativePath, resolveAppPath } from '@/lib/runtime/paths';
import { simpleId } from '@/lib/storage';
import { getVoiceSettings } from '@/lib/voice-settings';

export async function POST(request: Request) {
  const auth = await requireApiRole(['video', 'content']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const settings = await getVoiceSettings();
    const text = typeof body.text === 'string' && body.text.trim()
      ? body.text.trim()
      : '这是一段语音合成测试，用来验证视频工厂的音频生成、长文本切分和时长同步能力。';
    const voiceId = typeof body.voiceId === 'string' && body.voiceId.trim()
      ? body.voiceId.trim()
      : settings.provider === 'aliyun-cosyvoice'
        ? (settings.cosyvoiceTestVoiceId || 'longxiaochun_v2')
        : 'female-tianmei';
    const outputExtension = settings.provider === 'aliyun-cosyvoice' ? 'wav' : 'mp3';
    const outputRelativePath = generatedRelativePath('remotion', 'tts-api-test', `${simpleId('tts')}.${outputExtension}`);
    const reservation = await reserveCredits({
      user: auth.user,
      amount: 5,
      relatedType: 'voice',
      relatedId: outputRelativePath,
      note: 'TTS 试听'
    });

    let result;
    let durationSec;
    try {
      result = settings.provider === 'aliyun-cosyvoice'
        ? await synthesizeLongSpeechWithCosyVoice({
          text,
          outputRelativePath,
          voiceId,
          settings
        })
        : await synthesizeConfiguredSpeechWithMiniMax({
          text,
          outputRelativePath,
          voiceId,
          settings,
          format: 'mp3'
        });
      durationSec = await getAudioDurationSec(resolveAppPath(result.relativePath));
      await captureReservation(reservation.reservationId, 'TTS 试听完成');
    } catch (error) {
      await refundReservation(reservation.reservationId, 'TTS 试听失败');
      throw error;
    }

    return NextResponse.json({
      ok: true,
      audio: result,
      durationSec,
      provider: settings.provider,
      model: settings.provider === 'aliyun-cosyvoice' ? settings.cosyvoiceModel : settings.minimaxTtsModel,
      baseUrl: settings.provider === 'aliyun-cosyvoice' ? settings.dashscopeBaseUrl : settings.minimaxBaseUrl,
      voiceId
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'TTS test failed' },
      { status: creditErrorStatus(error) }
    );
  }
}
