import { NextResponse } from 'next/server';
import { appendAuditLog } from '@/lib/audit';
import { requireApiRole } from '@/lib/api-auth';
import { getSafeVoiceSettings, updateVoiceSettings } from '@/lib/voice-settings';

export async function GET() {
  const auth = await requireApiRole(['video', 'content']);
  if (!auth.ok) return auth.response;

  const settings = await getSafeVoiceSettings();
  return NextResponse.json({ ok: true, settings });
}

export async function PUT(request: Request) {
  const auth = await requireApiRole(['video']);
  if (!auth.ok) return auth.response;
  if (auth.user.role === 'creator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const settings = await updateVoiceSettings(body);
    await appendAuditLog({
      actor: auth.user,
      action: 'voice.settings.update',
      targetType: 'system',
      targetId: 'voice-settings',
      summary: `更新语音供应商配置：${settings.provider}`
    });
    const safeSettings = await getSafeVoiceSettings();
    return NextResponse.json({ ok: true, settings: safeSettings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update voice settings' },
      { status: 500 }
    );
  }
}

