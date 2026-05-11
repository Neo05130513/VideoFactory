import { revokeSessionsForUser } from './auth';
import { hashPassword } from './passwords';
import { nowIso, readJsonFile, simpleId, writeJsonFile } from './storage';
import type { UserAccount, UserRole } from './types';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 1000 * 60 * 15;
const MIN_PASSWORD_LENGTH = 8;

async function readUsers() {
  return readJsonFile<UserAccount[]>('data/users.json').catch(() => []);
}

async function writeUsers(users: UserAccount[]) {
  await writeJsonFile('data/users.json', users);
}

function ensurePasswordPolicy(password: string) {
  if (password.trim().length < MIN_PASSWORD_LENGTH) {
    throw new Error(`密码至少需要 ${MIN_PASSWORD_LENGTH} 位`);
  }
}

export async function listUsers() {
  return readUsers();
}

export async function touchUserLastLogin(userId: string) {
  const users = await readUsers();
  const index = users.findIndex((item) => item.id === userId);
  if (index === -1) return null;

  const user = { ...users[index], lastLoginAt: nowIso(), failedLoginAttempts: 0, lockedUntil: undefined };
  users[index] = user;
  await writeUsers(users);
  return user;
}

export async function recordFailedLoginAttempt(email: string) {
  const users = await readUsers();
  const normalizedEmail = email.trim().toLowerCase();
  const index = users.findIndex((item) => item.email === normalizedEmail);
  if (index === -1) return null;

  const current = users[index];
  const nextAttempts = (current.failedLoginAttempts || 0) + 1;
  const lockedUntil = nextAttempts >= MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : current.lockedUntil;
  const user = {
    ...current,
    failedLoginAttempts: nextAttempts,
    lockedUntil
  };
  users[index] = user;
  await writeUsers(users);
  return user;
}

export function isUserTemporarilyLocked(user: UserAccount) {
  return Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
}

export async function clearUserLockIfExpired(userId: string) {
  const users = await readUsers();
  const index = users.findIndex((item) => item.id === userId);
  if (index === -1) return null;

  const current = users[index];
  if (!current.lockedUntil) return current;
  if (new Date(current.lockedUntil).getTime() > Date.now()) return current;

  const user = { ...current, failedLoginAttempts: 0, lockedUntil: undefined };
  users[index] = user;
  await writeUsers(users);
  return user;
}

export async function createUserAccount(input: { name: string; email: string; password: string; role: UserRole; mustChangePassword?: boolean }) {
  const users = await readUsers();
  const email = input.email.trim().toLowerCase();
  ensurePasswordPolicy(input.password);
  if (users.some((item) => item.email.toLowerCase() === email)) {
    throw new Error('该邮箱已存在');
  }

  const user: UserAccount = {
    id: simpleId('user'),
    name: input.name.trim(),
    email,
    passwordHash: hashPassword(input.password),
    role: input.role,
    createdAt: nowIso(),
    disabledAt: undefined,
    lastLoginAt: undefined,
    failedLoginAttempts: 0,
    lockedUntil: undefined,
    mustChangePassword: input.mustChangePassword ?? true
  };

  await writeUsers([user, ...users]);
  return user;
}

export async function updateUserRole(userId: string, role: UserRole) {
  const users = await readUsers();
  const index = users.findIndex((item) => item.id === userId);
  if (index === -1) throw new Error('用户不存在');

  const user = { ...users[index], role };
  users[index] = user;
  await writeUsers(users);
  return user;
}

export async function resetUserPassword(userId: string, nextPassword: string) {
  const users = await readUsers();
  const index = users.findIndex((item) => item.id === userId);
  if (index === -1) throw new Error('用户不存在');
  ensurePasswordPolicy(nextPassword);

  const user = { ...users[index], passwordHash: hashPassword(nextPassword), failedLoginAttempts: 0, lockedUntil: undefined, mustChangePassword: true };
  users[index] = user;
  await writeUsers(users);
  await revokeSessionsForUser(userId);
  return user;
}

export async function changeOwnPassword(userId: string, nextPassword: string) {
  const users = await readUsers();
  const index = users.findIndex((item) => item.id === userId);
  if (index === -1) throw new Error('用户不存在');
  ensurePasswordPolicy(nextPassword);

  const user = { ...users[index], passwordHash: hashPassword(nextPassword), failedLoginAttempts: 0, lockedUntil: undefined, mustChangePassword: false };
  users[index] = user;
  await writeUsers(users);
  await revokeSessionsForUser(userId);
  return user;
}

export async function disableUserAccount(userId: string) {
  const users = await readUsers();
  const index = users.findIndex((item) => item.id === userId);
  if (index === -1) throw new Error('用户不存在');

  const current = users[index];
  if (current.role === 'admin') {
    const activeAdmins = users.filter((item) => item.role === 'admin' && !item.disabledAt);
    if (activeAdmins.length <= 1) {
      throw new Error('不能停用最后一个管理员账号');
    }
  }

  const user = { ...current, disabledAt: current.disabledAt || nowIso() };
  users[index] = user;
  await writeUsers(users);
  await revokeSessionsForUser(userId);
  return user;
}

export async function enableUserAccount(userId: string) {
  const users = await readUsers();
  const index = users.findIndex((item) => item.id === userId);
  if (index === -1) throw new Error('用户不存在');

  const user = { ...users[index], disabledAt: undefined, failedLoginAttempts: 0, lockedUntil: undefined };
  users[index] = user;
  await writeUsers(users);
  return user;
}
