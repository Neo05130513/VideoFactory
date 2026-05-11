import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { getTutorials } from '@/lib/queries';
import { mapTrendToTutorials } from '@/lib/trends';

export async function POST(request: Request) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const keyword = body.keyword as string;

  if (!keyword) {
    return NextResponse.json({ error: 'keyword is required' }, { status: 400 });
  }

  const tutorials = await getTutorials();
  const matches = mapTrendToTutorials(keyword, tutorials);

  return NextResponse.json({ matches });
}
