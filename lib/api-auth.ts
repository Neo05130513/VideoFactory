import { NextResponse } from 'next/server';
import type { UserRole } from './types';
import { getCurrentUser } from './auth';

export async function requireApiRole(roles: UserRole[]) {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (user.mustChangePassword) {
    return { ok: false as const, response: NextResponse.json({ error: 'Password change required' }, { status: 403 }) };
  }

  const creatorAllowed = user.role === 'creator' && (roles.includes('content') || roles.includes('video') || roles.includes('creator'));
  if (user.role !== 'admin' && !roles.includes(user.role) && !creatorAllowed) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { ok: true as const, user };
}
