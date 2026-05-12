import { NextResponse } from 'next/server';
import { appendAuditLog } from '@/lib/audit';
import { requireApiRole } from '@/lib/api-auth';
import { getSafeAiSettings, updateAiSettings } from '@/lib/ai-settings';

export async function GET() {
  const auth = await requireApiRole(['video', 'content', 'ops']);
  if (!auth.ok) return auth.response;

  const settings = await getSafeAiSettings();
  return NextResponse.json({ ok: true, settings });
}

export async function PUT(request: Request) {
  const auth = await requireApiRole(['video', 'ops']);
  if (!auth.ok) return auth.response;
  if (auth.user.role === 'creator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const settings = await updateAiSettings(body);
    await appendAuditLog({
      actor: auth.user,
      action: 'ai.settings.update',
      targetType: 'system',
      targetId: 'ai-settings',
      summary: `Updated AI service settings: text=${settings.textGenerationProvider}, image=${settings.videoImageProvider}, speech=${settings.videoSpeechProvider}`
    });
    const safeSettings = await getSafeAiSettings();
    return NextResponse.json({ ok: true, settings: safeSettings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update AI settings' },
      { status: 500 }
    );
  }
}
