import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { updateUserRole } from '@/lib/users';
import type { UserRole } from '@/lib/types';

const allowedRoles: UserRole[] = ['admin', 'content', 'video', 'ops', 'creator'];

export async function POST(request: Request) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const userId = String(body.userId || '').trim();
    const role = body.role as UserRole | undefined;

    if (!userId || !role) {
      return NextResponse.json({ error: 'userId and role are required' }, { status: 400 });
    }

    if (!allowedRoles.includes(role)) {
      return NextResponse.json({ error: 'role is invalid' }, { status: 400 });
    }

    const user = await updateUserRole(userId, role);
    await appendAuditLog({
      actor: auth.user,
      action: 'user.role.update',
      targetType: 'system',
      targetId: user.id,
      summary: `更新账号角色：${user.name} -> ${user.role}`
    });

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update role' }, { status: 500 });
  }
}
