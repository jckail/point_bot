import { LoyaltyAccountNotFoundError } from "../../domain/errors";
import type { LoyaltyAccount } from "../../domain/loyalty/loyalty-account";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";

/**
 * Loads an account and enforces ownership. Other users' accounts surface as
 * not-found so their existence is never revealed. Soft-deleted accounts are
 * also treated as not-found for normal mutations (use restore instead).
 */
export async function requireOwnedAccount(
  accounts: LoyaltyAccountRepository,
  userId: string,
  accountId: string,
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
  userId: string,
  accountId: string,
): Promise<LoyaltyAccount> {
  const account = await accounts.findById(accountId);
  if (!account || account.userId !== userId) {
    throw new LoyaltyAccountNotFoundError(accountId);
  }
  return account;
}
