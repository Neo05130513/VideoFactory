import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { ensureCreditAccount } from '@/lib/credits';
import { createUserAccount } from '@/lib/users';
import type { UserRole } from '@/lib/types';

const allowedRoles: UserRole[] = ['admin', 'content', 'video', 'ops', 'creator'];

export async function POST(request: Request) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim();
    const role = body.role as UserRole | undefined;

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: 'name, email, password, role are required' }, { status: 400 });
    }

    if (!allowedRoles.includes(role)) {
      return NextResponse.json({ error: 'role is invalid' }, { status: 400 });
    }

    const user = await createUserAccount({ name, email, password, role });
    await ensureCreditAccount(user.id);
    await appendAuditLog({
      actor: auth.user,
      action: 'user.create',
      targetType: 'system',
      targetId: user.id,
      summary: `创建账号：${user.name} (${user.role})`
    });

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create user' }, { status: 500 });
  }
}
