import type { UserAccount } from './types';

export type OwnedRecord = {
  ownerUserId?: string;
};

export function canAccessOwnedRecord(user: Pick<UserAccount, 'id' | 'role'> | null | undefined, ownerUserId?: string) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!ownerUserId) return user.role !== 'creator';
  return ownerUserId === user.id;
}

export function filterOwnedRecords<T extends OwnedRecord>(items: T[], user: Pick<UserAccount, 'id' | 'role'> | null | undefined) {
  return items.filter((item) => canAccessOwnedRecord(user, item.ownerUserId));
}

export function assertCanAccessOwnedRecord(user: Pick<UserAccount, 'id' | 'role'>, ownerUserId?: string, label = 'resource') {
  if (!canAccessOwnedRecord(user, ownerUserId)) {
    throw new Error(`Forbidden ${label}`);
  }
}
