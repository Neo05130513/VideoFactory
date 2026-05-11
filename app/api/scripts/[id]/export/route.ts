import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { buildScriptExportText } from '@/lib/script-ops';
import { readJsonFile } from '@/lib/storage';
import type { Script } from '@/lib/types';

export async function GET(_: Request, context: { params: { id: string } }) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  const scripts = await readJsonFile<Script[]>('data/scripts.json');
  const script = scripts.find((item) => item.id === context.params.id);

  if (!script) {
    return NextResponse.json({ error: 'Script not found' }, { status: 404 });
  }

  try {
    assertCanAccessOwnedRecord(auth.user, script.ownerUserId, 'script');
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Forbidden script' },
      { status: 403 }
    );
  }

  const text = buildScriptExportText(script);
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(script.title)}.txt"`
    }
  });
}
