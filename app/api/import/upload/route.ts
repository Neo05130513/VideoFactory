import { writeFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { appendAuditLog } from '@/lib/audit';
import { requireApiRole } from '@/lib/api-auth';
import { captureReservation, refundReservation, reserveCredits } from '@/lib/credits';
import { inferSourceType } from '@/lib/files';
import { importTutorials } from '@/lib/pipeline';
import { ensureDirectory, simpleId } from '@/lib/storage';
import { resolveDataPath } from '@/lib/runtime/paths';
import type { SourceType } from '@/lib/types';

function safeFileName(fileName: string, fallback: string) {
  const normalized = fileName.replace(/[\\/:"*?<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

async function saveImportFile(file: File) {
  const sourceType = inferSourceType(file.name);
  if (!sourceType) throw new Error(`Unsupported file type: ${file.name}`);

  const fileName = safeFileName(file.name, `document.${sourceType}`);
  const relativePath = path.posix.join('data', 'imports', 'uploads', simpleId('upload'), fileName);
  const absolutePath = resolveDataPath(relativePath);
  await ensureDirectory(path.dirname(absolutePath));
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));
  return { sourceFile: relativePath, sourceType };
}

async function savePastedText(title: string, text: string) {
  const sourceType: SourceType = 'txt';
  const fileName = `${safeFileName(title || 'pasted-text', 'pasted-text').replace(/\.[^.]+$/, '')}.txt`;
  const relativePath = path.posix.join('data', 'imports', 'uploads', simpleId('paste'), fileName);
  const absolutePath = resolveDataPath(relativePath);
  await ensureDirectory(path.dirname(absolutePath));
  await writeFile(absolutePath, text, 'utf-8');
  return { sourceFile: relativePath, sourceType };
}

export async function POST(request: Request) {
  const auth = await requireApiRole(['content', 'video']);
  if (!auth.ok) return auth.response;

  let reservationId: string | undefined;

  try {
    const form = await request.formData();
    const files = form.getAll('documents').filter((item): item is File => item instanceof File && item.size > 0);
    const pastedText = form.get('text');
    const pastedTitle = form.get('title');

    const inputs = [];
    for (const file of files) {
      inputs.push(await saveImportFile(file));
    }

    if (typeof pastedText === 'string' && pastedText.trim()) {
      inputs.push(await savePastedText(typeof pastedTitle === 'string' ? pastedTitle : 'pasted-text', pastedText.trim()));
    }

    if (!inputs.length) {
      return NextResponse.json({ error: 'Upload a document or paste text.' }, { status: 400 });
    }

    const reservation = await reserveCredits({
      user: auth.user,
      amount: inputs.length * 3,
      relatedType: 'import',
      relatedId: simpleId('import_batch'),
      note: `Import ${inputs.length} document(s)`
    });
    reservationId = reservation.reservationId;

    const result = await importTutorials(inputs, { ownerUserId: auth.user.id });
    await captureReservation(reservationId, 'Import completed');
    await Promise.all((result.created || []).map((tutorial) => appendAuditLog({
      actor: auth.user,
      action: 'tutorial.import.upload',
      targetType: 'tutorial',
      targetId: tutorial.id,
      summary: `上传导入文档：${tutorial.title}`
    })));
    return NextResponse.json(result);
  } catch (error) {
    await refundReservation(reservationId, 'Import failed').catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Document import failed' },
      { status: 500 }
    );
  }
}
