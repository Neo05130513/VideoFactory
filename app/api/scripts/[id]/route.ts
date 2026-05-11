import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { assertCanAccessOwnedRecord } from '@/lib/ownership';
import { deleteScriptsByIds, updateScriptContent } from '@/lib/script-ops';
import { readJsonFile } from '@/lib/storage';
import type { Script } from '@/lib/types';

async function assertScriptAccess(user: Parameters<typeof assertCanAccessOwnedRecord>[0], scriptId: string) {
  const scripts = await readJsonFile<Script[]>('data/scripts.json');
  const script = scripts.find((item) => item.id === scriptId);
  if (!script) throw new Error('Script not found');
  assertCanAccessOwnedRecord(user, script.ownerUserId, 'script');
  return script;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  try {
    await assertScriptAccess(auth.user, params.id);
    const body = await request.json();
    const title = String(body.title || '').trim();
    const hook = String(body.hook || '').trim();
    const bodyText = String(body.body || '').trim();
    const cta = String(body.cta || '').trim();
    const style = String(body.style || '').trim();

    if (!title || !hook || !bodyText || !cta || !style) {
      return NextResponse.json({ error: 'title, hook, body, cta, style are required' }, { status: 400 });
    }

    const script = await updateScriptContent(params.id, {
      title,
      hook,
      body: bodyText,
      cta,
      style
    });

    await appendAuditLog({
      actor: auth.user,
      action: 'script.update',
      targetType: 'script',
      targetId: script.id,
      summary: `编辑脚本内容：${script.title}`
    });

    return NextResponse.json({ script });
  } catch (error) {
    if (error instanceof Error && /^Forbidden/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && /净化后为空/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update script' },
      { status: 500 }
    );
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiRole(['content']);
  if (!auth.ok) return auth.response;

  try {
    await assertScriptAccess(auth.user, params.id);
    const deletedScripts = await deleteScriptsByIds([params.id]);
    await Promise.all(deletedScripts.map((script) => appendAuditLog({
      actor: auth.user,
      action: 'script.delete',
      targetType: 'script',
      targetId: script.id,
      summary: `删除脚本：${script.title}`
    })));

    return NextResponse.json({ deleted: deletedScripts.map((script) => ({ id: script.id, title: script.title })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete script';
    const status = /^Forbidden/i.test(message) ? 403 : /not found/i.test(message) ? 404 : /不能删除|required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
