import { NextResponse } from 'next/server';
import { generateTopics } from '@/lib/topics';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { creditErrorStatus } from '@/lib/render-credit';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { readJsonFile, writeJsonFile } from '@/lib/storage';
import { Topic, Tutorial } from '@/lib/types';

export async function POST(request: Request) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const tutorialId = body.tutorialId as string;
  const tutorials = await readJsonFile<Tutorial[]>('data/tutorials.json');
  const topics = await readJsonFile<Topic[]>('data/topics.json');
  const tutorial = tutorials.find((item) => item.id === tutorialId);

  if (!tutorial) {
    return NextResponse.json({ error: 'Tutorial not found' }, { status: 404 });
  }

  try {
    assertCanAccessOwnedRecord(auth.user, tutorial.ownerUserId, 'tutorial');
    const reservation = await reserveCredits({
      user: auth.user,
      amount: 5,
      relatedType: 'pipeline',
      relatedId: tutorial.id,
      note: `生成选题：${tutorial.title}`
    });

    try {
      const ownerUserId = tutorial.ownerUserId || (auth.user.role === 'creator' ? auth.user.id : undefined);
      const generated = (await generateTopics(tutorial)).map((topic) => ({
        ...topic,
        ownerUserId
      }));
      const nextTopics = [...generated, ...topics.filter((item) => item.tutorialId !== tutorialId)];
      await writeJsonFile('data/topics.json', nextTopics);
      await captureReservation(reservation.reservationId, '选题生成完成');
      await appendAuditLog({
        actor: auth.user,
        action: 'topic.generate',
        targetType: 'tutorial',
        targetId: tutorial.id,
        summary: `生成选题 ${generated.length} 条：${tutorial.title}`
      });

      return NextResponse.json({ topics: generated });
    } catch (error) {
      await refundReservation(reservation.reservationId, '选题生成失败');
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate topics' },
      { status: creditErrorStatus(error) }
    );
  }
}
