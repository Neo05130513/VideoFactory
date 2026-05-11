import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { appendAuditLog } from './audit';
import { nowIso, readJsonFile, simpleId, writeJsonFile } from './storage';
import { verifyPassword } from './passwords';
import { clearUserLockIfExpired, isUserTemporarilyLocked, recordFailedLoginAttempt, touchUserLastLogin } from './users';
import type { UserAccount, UserRole, UserSession } from './types';

const SESSION_COOKIE = 'video_factory_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export async function getUsers() {
  return readJsonFile<UserAccount[]>('data/users.json');
}

export async function getSessions() {
  return readJsonFile<UserSession[]>('data/sessions.json');
}

export async function revokeSessionsForUser(userId: string) {
  const sessions = await getSessions();
  await writeJsonFile('data/sessions.json', sessions.filter((item) => item.userId !== userId));
}

export async function revokeSessionById(sessionId: string) {
  const sessions = await getSessions();
  await writeJsonFile('data/sessions.json', sessions.filter((item) => item.id !== sessionId));
}

export async function loginWithPassword(email: string, password: string) {
  const [users, sessions] = await Promise.all([getUsers(), getSessions()]);
  const normalizedEmail = email.trim().toLowerCase();
  const rawUser = users.find((item) => item.email === normalizedEmail);
  const user = rawUser ? await clearUserLockIfExpired(rawUser.id) : null;

  if (user && isUserTemporarilyLocked(user)) {
    await appendAuditLog({
      actor: { id: user.id, name: user.name, role: user.role },
      action: 'auth.login.blocked',
      targetType: 'system',
      targetId: user.id,
      summary: `登录被锁定：${user.email}`
    });
    throw new Error('登录失败次数过多，请稍后再试');
  }

  if (!user || user.disabledAt || !verifyPassword(password, user.passwordHash)) {
    const failedUser = await recordFailedLoginAttempt(normalizedEmail);
    const actor = failedUser
      ? { id: failedUser.id, name: failedUser.name, role: failedUser.role }
      : { id: `login:${normalizedEmail || 'unknown'}`, name: normalizedEmail || 'unknown', role: 'ops' as const };
    const summary = failedUser?.lockedUntil && new Date(failedUser.lockedUntil).getTime() > Date.now()
      ? `登录失败并触发锁定：${normalizedEmail || 'unknown'}`
      : `登录失败：${normalizedEmail || 'unknown'}`;

    await appendAuditLog({
      actor,
      action: 'auth.login.failed',
      targetType: 'system',
      targetId: actor.id,
      summary
    });
    throw new Error('账号或密码错误');
  }

  const touchedUser = await touchUserLastLogin(user.id);
  const session: UserSession = {
    id: simpleId('session'),
    userId: user.id,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };

  await writeJsonFile('data/sessions.json', [session, ...sessions.filter((item) => item.userId !== user.id)]);
  cookies().set(SESSION_COOKIE, session.id, { httpOnly: true, sameSite: 'lax', path: '/' });
  await appendAuditLog({
    actor: { id: user.id, name: user.name, role: user.role },
    action: 'auth.login.success',
    targetType: 'system',
    targetId: user.id,
    summary: `登录成功：${user.email}`
  });
  return touchedUser || user;
}

export async function logoutCurrentUser() {
  const sessionId = cookies().get(SESSION_COOKIE)?.value;
  if (!sessionId) return;
  const sessions = await getSessions();
  await writeJsonFile('data/sessions.json', sessions.filter((item) => item.id !== sessionId));
  cookies().set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', expires: new Date(0) });
}

export async function getCurrentUser() {
  const sessionId = cookies().get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const [users, sessions] = await Promise.all([getUsers(), getSessions()]);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;

  const user = users.find((item) => item.id === session.userId) || null;
  if (!user || user.disabledAt) return null;
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireRole(roles: UserRole[]) {
  const user = await requireUser();
  if (user.mustChangePassword) {
    redirect('/change-password');
  }
  const creatorAllowed = user.role === 'creator' && (roles.includes('content') || roles.includes('video') || roles.includes('creator'));
  if (!roles.includes(user.role) && user.role !== 'admin' && !creatorAllowed) {
    redirect('/');
  }
  return user;
}

export async function requireNoForcedPasswordChange() {
  const user = await requireUser();
  if (user.mustChangePassword) {
    redirect('/change-password');
  }
  return user;
}

export function canManageContent(role: UserRole) {
  return role === 'admin' || role === 'content' || role === 'creator';
}

export function canManageVideo(role: UserRole) {
  return role === 'admin' || role === 'video' || role === 'creator';
}

export function canManageOps(role: UserRole) {
  return role === 'admin' || role === 'ops';
}
