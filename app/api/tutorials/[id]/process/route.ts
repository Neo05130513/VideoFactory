import { NextResponse } from 'next/server';
import { processTutorialPipeline } from '@/lib/pipeline';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { creditErrorStatus } from '@/lib/render-credit';
import { readJsonFile } from '@/lib/storage';
import type { Tutorial } from '@/lib/types';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  try {
    const tutorials = await readJsonFile<Tutorial[]>('data/tutorials.json');
    const tutorial = tutorials.find((item) => item.id === params.id);
    if (!tutorial) {
      return NextResponse.json({ error: 'Tutorial not found' }, { status: 404 });
    }
    assertCanAccessOwnedRecord(auth.user, tutorial.ownerUserId, 'tutorial');

    const reservation = await reserveCredits({
      user: auth.user,
      amount: 25,
      relatedType: 'pipeline',
      relatedId: params.id,
      note: `执行完整流程：${tutorial.title}`
    });

    let result;
    try {
      result = await processTutorialPipeline(params.id);
      await captureReservation(reservation.reservationId, '完整流程处理完成');
    } catch (error) {
      await refundReservation(reservation.reservationId, '完整流程处理失败');
      throw error;
    }

    await appendAuditLog({
      actor: auth.user,
      action: 'tutorial.process_pipeline',
      targetType: 'tutorial',
      targetId: result.tutorial.id,
      summary: `执行教程完整流程：${result.tutorial.title}`
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '教程处理失败' },
      { status: creditErrorStatus(error) }
    );
  }
}
