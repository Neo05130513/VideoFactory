import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { deleteScriptsByIds } from '@/lib/script-ops';
import { readJsonFile } from '@/lib/storage';
import type { Script } from '@/lib/types';

export async function POST(request: Request) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const scriptIds = Array.isArray(body.scriptIds) ? body.scriptIds.map((item: unknown) => String(item || '').trim()).filter(Boolean) : [];
    if (!scriptIds.length) {
      return NextResponse.json({ error: 'scriptIds is required' }, { status: 400 });
    }

    const scripts = await readJsonFile<Script[]>('data/scripts.json');
    const scriptById = new Map(scripts.map((script) => [script.id, script]));
    for (const scriptId of scriptIds) {
      const script = scriptById.get(scriptId);
      if (!script) {
        return NextResponse.json({ error: `Script not found: ${scriptId}` }, { status: 404 });
      }
      assertCanAccessOwnedRecord(auth.user, script.ownerUserId, 'script');
    }

    const deletedScripts = await deleteScriptsByIds(scriptIds);
    await Promise.all(deletedScripts.map((script) => appendAuditLog({
      actor: auth.user,
      action: 'script.delete',
      targetType: 'script',
      targetId: script.id,
      summary: `删除脚本：${script.title}`
    })));

    return NextResponse.json({
      deleted: deletedScripts.map((script) => ({ id: script.id, title: script.title })),
      count: deletedScripts.length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete scripts';
    const status = /^Forbidden/i.test(message) ? 403 : /not found/i.test(message) ? 404 : /不能删除|required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
