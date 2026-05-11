import { NextResponse } from 'next/server';
import { generateScripts } from '@/lib/scripts';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { creditErrorStatus } from '@/lib/render-credit';
import { readJsonFile, writeJsonFile } from '@/lib/storage';
import { Script, Topic, Tutorial } from '@/lib/types';

export async function POST(request: Request) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const topicId = body.topicId as string;

    const topics = await readJsonFile<Topic[]>('data/topics.json');
    const tutorials = await readJsonFile<Tutorial[]>('data/tutorials.json');
    const scripts = await readJsonFile<Script[]>('data/scripts.json');

    const topic = topics.find((item) => item.id === topicId);
    if (!topic) {
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
    }

    const tutorial = tutorials.find((item) => item.id === topic.tutorialId);
    if (!tutorial) {
      return NextResponse.json({ error: 'Tutorial not found' }, { status: 404 });
    }

    assertCanAccessOwnedRecord(auth.user, topic.ownerUserId || tutorial.ownerUserId, 'topic');
    const reservation = await reserveCredits({
      user: auth.user,
      amount: 8,
      relatedType: 'pipeline',
      relatedId: topic.id,
      note: `生成脚本：${topic.title}`
    });

    try {
      const ownerUserId = topic.ownerUserId || tutorial.ownerUserId || (auth.user.role === 'creator' ? auth.user.id : undefined);
      const generated = (await generateScripts(topic, tutorial)).map((script) => ({
        ...script,
        ownerUserId
      }));
      const nextScripts = [...generated, ...scripts.filter((item) => item.topicId !== topicId)];
      await writeJsonFile('data/scripts.json', nextScripts);
      await captureReservation(reservation.reservationId, '脚本生成完成');
      await Promise.all(generated.map((script) => appendAuditLog({
        actor: auth.user,
        action: 'script.generate',
        targetType: 'script',
        targetId: script.id,
        summary: `生成脚本：${script.title}`
      })));

      return NextResponse.json({ scripts: generated });
    } catch (error) {
      await refundReservation(reservation.reservationId, '脚本生成失败');
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '脚本生成失败' },
      { status: creditErrorStatus(error) }
    );
  }
}
