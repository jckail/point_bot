import type { Eventing } from "../events/ports";
import { LoyaltyAccountNotFoundError } from "../../domain/errors";
import type { LoyaltyAccount } from "../../domain/loyalty/loyalty-account";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";

import type { LoyaltyAccountId, UserId } from "../../domain/shared/ids";
/**
 * Loads an account and enforces ownership. Other users' accounts surface as
 * not-found so their existence is never revealed. Soft-deleted accounts are
 * also treated as not-found for normal mutations (use restore instead).
 */
export async function requireOwnedAccount(
  accounts: LoyaltyAccountRepository,
  userId: UserId,
  accountId: LoyaltyAccountId,
): Promise<LoyaltyAccount> {
  const account = await accounts.findById(accountId);
  if (!account || account.userId !== userId || account.deletedAt) {
    throw new LoyaltyAccountNotFoundError(accountId);
  }
  return account;
}

/**
 * Like requireOwnedAccount but allows soft-deleted rows (for restore).
 */
export async function requireOwnedAccountIncludingDeleted(
  accounts: LoyaltyAccountRepository,
  userId: UserId,
  accountId: LoyaltyAccountId,
): Promise<LoyaltyAccount> {
  const account = await accounts.findById(accountId);
  if (!account || account.userId !== userId) {
    throw new LoyaltyAccountNotFoundError(accountId);
  }
  return account;
}

/** Call inside the mutation UOW. Production row locks must live until commit. */
export async function requireOwnedAccountForMutation(
  accounts: LoyaltyAccountRepository, userId: UserId, accountId: LoyaltyAccountId,
  eventing: Eventing, includeDeleted = false,
): Promise<LoyaltyAccount> {
  if (Boolean(accounts.lockById) !== eventing.unitOfWork.atomic) {
    throw new Error("Account mutations require an atomic unit of work and account locking");
  }
  const account = accounts.lockById ? await accounts.lockById(accountId) : await accounts.findById(accountId);
  if (!account || account.userId !== userId || (!includeDeleted && account.deletedAt)) {
    throw new LoyaltyAccountNotFoundError(accountId);
  }
  return account;
}
