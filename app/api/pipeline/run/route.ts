import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { processTutorialPipeline } from '@/lib/pipeline';

export async function POST(request: Request) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const tutorialId = body.tutorialId as string | undefined;
    const tutorialIds = body.tutorialIds as string[] | undefined;

    const targets = tutorialId ? [tutorialId] : Array.isArray(tutorialIds) ? tutorialIds : [];
    if (!targets.length) {
      return NextResponse.json({ error: 'tutorialId or tutorialIds is required' }, { status: 400 });
    }

    const results = [];
    for (const id of targets) {
      const reservation = await reserveCredits({
        user: auth.user,
        amount: 25,
        relatedType: 'pipeline',
        relatedId: id,
        note: 'Run script pipeline'
      });
      try {
        const result = await processTutorialPipeline(id);
        await captureReservation(reservation.reservationId, 'Script pipeline completed');
        results.push(result);
      } catch (error) {
        await refundReservation(reservation.reservationId, 'Script pipeline failed').catch(() => undefined);
        throw error;
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '教程处理失败' },
      { status: 500 }
    );
  }
}
