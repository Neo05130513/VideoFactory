import { NextResponse } from 'next/server';
import { appendAuditLog } from '@/lib/audit';
import { requireApiRole } from '@/lib/api-auth';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { ensureVoiceProfileReady } from '@/lib/voice-provider';
import { getVoiceProfileById } from '@/lib/voice-profiles';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiRole(['video']);
  if (!auth.ok) return auth.response;

  try {
    const profile = await getVoiceProfileById(params.id);
    if (!profile || profile.userId !== auth.user.id) {
      return NextResponse.json({ error: 'Voice profile not found' }, { status: 404 });
    }

    const reservation = await reserveCredits({
      user: auth.user,
      amount: 80,
      relatedType: 'voice',
      relatedId: profile.id,
      note: `重试声音复刻：${profile.name}`
    });

    let readyProfile;
    try {
      readyProfile = await ensureVoiceProfileReady(profile);
      await captureReservation(reservation.reservationId, '声音复刻重试完成');
    } catch (error) {
      await refundReservation(reservation.reservationId, '声音复刻重试失败');
      throw error;
    }

    await appendAuditLog({
      actor: auth.user,
      action: 'voice.clone.retry',
      targetType: 'system',
      targetId: readyProfile.id,
      summary: `重试声音复刻：${readyProfile.name}`
    });
    return NextResponse.json({ ok: true, profile: readyProfile });
  } catch (error) {
    const latestProfile = await getVoiceProfileById(params.id);
    const message = error instanceof Error ? error.message : 'Voice clone retry failed';
    return NextResponse.json(
      {
        error: message,
        profile: latestProfile
      },
      { status: /积分|credit|余额|不足|冻结/i.test(message) ? 402 : 502 }
    );
  }
}
