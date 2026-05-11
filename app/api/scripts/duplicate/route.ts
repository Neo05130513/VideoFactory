import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { duplicateScriptVersion } from '@/lib/script-ops';
import { readJsonFile } from '@/lib/storage';
import type { Script } from '@/lib/types';

export async function POST(request: Request) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const scriptId = body.scriptId as string | undefined;

    if (!scriptId) {
      return NextResponse.json({ error: 'scriptId is required' }, { status: 400 });
    }

    const scripts = await readJsonFile<Script[]>('data/scripts.json');
    const source = scripts.find((item) => item.id === scriptId);
    if (!source) {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }
    assertCanAccessOwnedRecord(auth.user, source.ownerUserId, 'script');

    const script = await duplicateScriptVersion(scriptId);
    await appendAuditLog({
      actor: auth.user,
      action: 'script.duplicate',
      targetType: 'script',
      targetId: script.id,
      summary: `复制脚本版本：${script.title}`
    });
    return NextResponse.json({ script });
  } catch (error) {
    if (error instanceof Error && /^Forbidden/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to duplicate script version' },
      { status: 500 }
    );
  }
}
