import { NextResponse } from 'next/server';
import { appendAuditLog } from '@/lib/audit';
import { requireApiRole } from '@/lib/api-auth';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { creditErrorStatus } from '@/lib/render-credit';
import { ensureVoiceProfileReady } from '@/lib/voice-provider';
import { getVoiceProfileById, saveUploadedVoiceSample } from '@/lib/voice-profiles';

export async function POST(request: Request) {
  const auth = await requireApiRole(['video', 'content']);
  if (!auth.ok) return auth.response;

  try {
    const form = await request.formData();
    const file = form.get('sample');
    const name = form.get('name');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Upload a voice sample file using form field "sample"' }, { status: 400 });
    }

    const profile = await saveUploadedVoiceSample({
      user: auth.user,
      fileName: file.name || 'voice-sample.wav',
      bytes: await file.arrayBuffer(),
      displayName: typeof name === 'string' ? name : undefined
    });

    await appendAuditLog({
      actor: auth.user,
      action: 'voice.sample.upload',
      targetType: 'system',
      targetId: profile.id,
      summary: `上传声音样本：${profile.name}`
    });

    const reservation = await reserveCredits({
      user: auth.user,
      amount: 80,
      relatedType: 'voice',
      relatedId: profile.id,
      note: `声音复刻：${profile.name}`
    });

    try {
      const readyProfile = await ensureVoiceProfileReady(profile);
      await captureReservation(reservation.reservationId, '声音复刻完成');
      await appendAuditLog({
        actor: auth.user,
        action: 'voice.clone.ready',
        targetType: 'system',
        targetId: readyProfile.id,
        summary: `声音复刻完成：${readyProfile.name}`
      });
      return NextResponse.json({ ok: true, profile: readyProfile });
    } catch (cloneError) {
      await refundReservation(reservation.reservationId, '声音复刻失败');
      const latestProfile = await getVoiceProfileById(profile.id);
      await appendAuditLog({
        actor: auth.user,
        action: 'voice.clone.failed',
        targetType: 'system',
        targetId: profile.id,
        summary: `声音复刻失败：${cloneError instanceof Error ? cloneError.message : 'unknown error'}`
      });
      return NextResponse.json(
        {
          error: cloneError instanceof Error ? cloneError.message : 'Voice clone failed',
          profile: latestProfile || profile
        },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Voice sample upload failed' },
      { status: creditErrorStatus(error) }
    );
  }
}
