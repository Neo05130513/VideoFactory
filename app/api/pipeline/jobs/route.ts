import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { reserveCredits } from '@/lib/credits';
import { enqueuePipelineJob } from '@/lib/pipeline-jobs';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { readJsonFile } from '@/lib/storage';
import type { Tutorial } from '@/lib/types';

export async function POST(request: Request) {
  const auth = await requireApiRole(['content', 'video']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const tutorialId = body.tutorialId as string | undefined;
    if (!tutorialId) {
      return NextResponse.json({ error: 'tutorialId is required' }, { status: 400 });
    }

    const tutorials = await readJsonFile<Tutorial[]>('data/tutorials.json');
    const tutorial = tutorials.find((item) => item.id === tutorialId);
    if (!tutorial) return NextResponse.json({ error: 'Tutorial not found' }, { status: 404 });
    assertCanAccessOwnedRecord(auth.user, tutorial.ownerUserId, 'tutorial');

    const reservation = await reserveCredits({
      user: auth.user,
      amount: 25,
      relatedType: 'pipeline',
      relatedId: tutorialId,
      note: 'Generate topic and script'
    });

    const job = await enqueuePipelineJob(tutorialId, {
      ownerUserId: auth.user.id,
      creditReservationId: reservation.reservationId
    });
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建教程处理任务失败' },
      { status: 500 }
    );
  }
}
