import { CREDIT_PLANS, type CreditPlanId } from './billing';
import { nowIso, readJsonFile, simpleId, writeJsonFile } from './storage';
import type { UserAccount } from './types';

const CREDIT_ACCOUNTS_PATH = 'data/credit-accounts.json';
const CREDIT_LEDGER_PATH = 'data/credit-ledger.json';

export type CreditAccountStatus = 'active' | 'frozen';
export type CreditLedgerType = 'grant' | 'reserve' | 'capture' | 'refund' | 'adjustment' | 'plan-change';
export type CreditRelatedType = 'import' | 'pipeline' | 'render' | 'voice' | 'admin' | 'subscription';

export type CreditAccount = {
  userId: string;
  planId: CreditPlanId;
  monthlyCredits: number;
  extraCredits: number;
  usedCredits: number;
  reservedCredits: number;
  periodStart: string;
  periodEnd: string;
  status: CreditAccountStatus;
  updatedAt: string;
};

export type CreditLedgerEntry = {
  id: string;
  userId: string;
  type: CreditLedgerType;
  amount: number;
  balanceAfter: number;
  reservedAfter: number;
  relatedType: CreditRelatedType;
  relatedId: string;
  note: string;
  createdAt: string;
};

function getPlan(planId: CreditPlanId) {
  return CREDIT_PLANS.find((plan) => plan.id === planId) || CREDIT_PLANS[0];
}

function monthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function availableCredits(account: CreditAccount) {
  return Math.max(0, account.monthlyCredits + account.extraCredits - account.usedCredits - account.reservedCredits);
}

async function readAccounts() {
  return readJsonFile<CreditAccount[]>(CREDIT_ACCOUNTS_PATH).catch(() => []);
}

async function writeAccounts(accounts: CreditAccount[]) {
  await writeJsonFile(CREDIT_ACCOUNTS_PATH, accounts);
}

async function readLedger() {
  return readJsonFile<CreditLedgerEntry[]>(CREDIT_LEDGER_PATH).catch(() => []);
}

async function writeLedger(entries: CreditLedgerEntry[]) {
  await writeJsonFile(CREDIT_LEDGER_PATH, entries);
}

function createDefaultAccount(userId: string): CreditAccount {
  const plan = getPlan('free');
  const period = monthWindow();
  return {
    userId,
    planId: 'free',
    monthlyCredits: plan.monthlyCredits,
    extraCredits: 0,
    usedCredits: 0,
    reservedCredits: 0,
    periodStart: period.start,
    periodEnd: period.end,
    status: 'active',
    updatedAt: nowIso()
  };
}

async function appendLedger(entry: Omit<CreditLedgerEntry, 'id' | 'createdAt'>) {
  const ledger = await readLedger();
  const nextEntry: CreditLedgerEntry = {
    id: simpleId('credit_ledger'),
    createdAt: nowIso(),
    ...entry
  };
  await writeLedger([nextEntry, ...ledger]);
  return nextEntry;
}

export function summarizeCreditAccount(account: CreditAccount) {
  return {
    ...account,
    totalCredits: account.monthlyCredits + account.extraCredits,
    availableCredits: availableCredits(account)
  };
}

export async function ensureCreditAccount(userId: string) {
  const accounts = await readAccounts();
  const existing = accounts.find((account) => account.userId === userId);
  if (existing) return existing;

  const account = createDefaultAccount(userId);
  await writeAccounts([account, ...accounts]);
  await appendLedger({
    userId,
    type: 'grant',
    amount: account.monthlyCredits,
    balanceAfter: availableCredits(account),
    reservedAfter: account.reservedCredits,
    relatedType: 'subscription',
    relatedId: account.planId,
    note: '注册默认免费版积分'
  });
  return account;
}

export async function listCreditAccountsForUsers(users: Pick<UserAccount, 'id'>[]) {
  const accounts = await readAccounts();
  const accountByUser = new Map(accounts.map((account) => [account.userId, account]));
  const missing = users.filter((user) => !accountByUser.has(user.id));
  if (missing.length) {
    const created = missing.map((user) => createDefaultAccount(user.id));
    await writeAccounts([...created, ...accounts]);
    for (const account of created) {
      await appendLedger({
        userId: account.userId,
        type: 'grant',
        amount: account.monthlyCredits,
        balanceAfter: availableCredits(account),
        reservedAfter: account.reservedCredits,
        relatedType: 'subscription',
        relatedId: account.planId,
        note: '自动补齐免费版积分账户'
      });
    }
    return [...created, ...accounts];
  }
  return accounts;
}

export async function listCreditLedger() {
  return readLedger();
}

async function updateAccount(userId: string, updater: (account: CreditAccount) => CreditAccount) {
  const accounts = await readAccounts();
  const index = accounts.findIndex((account) => account.userId === userId);
  const current = index === -1 ? createDefaultAccount(userId) : accounts[index];
  const next = { ...updater(current), updatedAt: nowIso() };
  const nextAccounts = index === -1
    ? [next, ...accounts]
    : accounts.map((account, accountIndex) => accountIndex === index ? next : account);
  await writeAccounts(nextAccounts);
  return next;
}

export async function reserveCredits(params: {
  user: Pick<UserAccount, 'id' | 'role'>;
  amount: number;
  relatedType: CreditRelatedType;
  relatedId: string;
  note: string;
}) {
  if (params.user.role === 'admin') {
    return { skipped: true as const, reservationId: undefined, account: null };
  }

  const amount = Math.max(1, Math.ceil(params.amount));
  const account = await ensureCreditAccount(params.user.id);
  if (account.status === 'frozen') {
    throw new Error('账号积分已冻结，请联系管理员处理');
  }
  if (availableCredits(account) < amount) {
    throw new Error(`积分不足：需要 ${amount}，当前可用 ${availableCredits(account)}`);
  }

  const nextAccount = await updateAccount(params.user.id, (current) => ({
    ...current,
    reservedCredits: current.reservedCredits + amount
  }));
  const entry = await appendLedger({
    userId: params.user.id,
    type: 'reserve',
    amount: -amount,
    balanceAfter: availableCredits(nextAccount),
    reservedAfter: nextAccount.reservedCredits,
    relatedType: params.relatedType,
    relatedId: params.relatedId,
    note: params.note
  });
  return { skipped: false as const, reservationId: entry.id, account: nextAccount };
}

function findReservation(ledger: CreditLedgerEntry[], reservationId: string) {
  const reservation = ledger.find((entry) => entry.id === reservationId && entry.type === 'reserve');
  if (!reservation) throw new Error('Credit reservation not found');
  const settled = ledger.some((entry) => entry.relatedId === reservationId && (entry.type === 'capture' || entry.type === 'refund'));
  return { reservation, settled };
}

export async function captureReservation(reservationId?: string, note = '确认扣除积分') {
  if (!reservationId) return null;
  const ledger = await readLedger();
  const { reservation, settled } = findReservation(ledger, reservationId);
  if (settled) return null;
  const amount = Math.abs(reservation.amount);
  const nextAccount = await updateAccount(reservation.userId, (current) => ({
    ...current,
    reservedCredits: Math.max(0, current.reservedCredits - amount),
    usedCredits: current.usedCredits + amount
  }));
  return appendLedger({
    userId: reservation.userId,
    type: 'capture',
    amount: -amount,
    balanceAfter: availableCredits(nextAccount),
    reservedAfter: nextAccount.reservedCredits,
    relatedType: reservation.relatedType,
    relatedId: reservationId,
    note
  });
}

export async function refundReservation(reservationId?: string, note = '退回预扣积分') {
  if (!reservationId) return null;
  const ledger = await readLedger();
  const { reservation, settled } = findReservation(ledger, reservationId);
  if (settled) return null;
  const amount = Math.abs(reservation.amount);
  const nextAccount = await updateAccount(reservation.userId, (current) => ({
    ...current,
    reservedCredits: Math.max(0, current.reservedCredits - amount)
  }));
  return appendLedger({
    userId: reservation.userId,
    type: 'refund',
    amount,
    balanceAfter: availableCredits(nextAccount),
    reservedAfter: nextAccount.reservedCredits,
    relatedType: reservation.relatedType,
    relatedId: reservationId,
    note
  });
}

export async function adjustUserCredits(params: {
  userId: string;
  amount: number;
  note: string;
}) {
  const amount = Math.trunc(params.amount);
  if (!amount) throw new Error('调整积分不能为 0');
  const nextAccount = await updateAccount(params.userId, (current) => ({
    ...current,
    extraCredits: Math.max(0, current.extraCredits + amount)
  }));
  return appendLedger({
    userId: params.userId,
    type: 'adjustment',
    amount,
    balanceAfter: availableCredits(nextAccount),
    reservedAfter: nextAccount.reservedCredits,
    relatedType: 'admin',
    relatedId: params.userId,
    note: params.note || '管理员手动调整积分'
  });
}

export async function changeUserPlan(params: {
  userId: string;
  planId: CreditPlanId;
  note: string;
}) {
  const plan = getPlan(params.planId);
  const period = monthWindow();
  const nextAccount = await updateAccount(params.userId, (current) => ({
    ...current,
    planId: plan.id,
    monthlyCredits: plan.monthlyCredits,
    usedCredits: 0,
    reservedCredits: 0,
    periodStart: period.start,
    periodEnd: period.end,
    status: 'active'
  }));
  return appendLedger({
    userId: params.userId,
    type: 'plan-change',
    amount: plan.monthlyCredits,
    balanceAfter: availableCredits(nextAccount),
    reservedAfter: nextAccount.reservedCredits,
    relatedType: 'subscription',
    relatedId: plan.id,
    note: params.note || `管理员切换套餐：${plan.name}`
  });
}

export async function setCreditAccountStatus(params: {
  userId: string;
  status: CreditAccountStatus;
  note: string;
}) {
  const nextAccount = await updateAccount(params.userId, (current) => ({
    ...current,
    status: params.status
  }));
  return appendLedger({
    userId: params.userId,
    type: 'adjustment',
    amount: 0,
    balanceAfter: availableCredits(nextAccount),
    reservedAfter: nextAccount.reservedCredits,
    relatedType: 'admin',
    relatedId: params.userId,
    note: params.note || `管理员${params.status === 'frozen' ? '冻结' : '恢复'}积分账户`
  });
}
