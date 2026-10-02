import { LoyaltyAccountNotFoundError } from "../../domain/errors";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";
import type { LoyaltyAccountId, UserId } from "../../domain/shared/ids";
import type { Eventing } from "../events/ports";
import { requireOwnedAccountForMutation } from "./access";

/** Called inside the mutation UOW, before writing the goal or its memberships. */
export async function lockGoalAccountReferences(
  accounts: LoyaltyAccountRepository, userId: UserId,
  accountIds: readonly LoyaltyAccountId[], eventing: Eventing,
): Promise<void> {
  const candidates = [];
  for (const id of new Set(accountIds)) {
    const account = await accounts.findById(id);
    if (!account || account.userId !== userId) throw new LoyaltyAccountNotFoundError(id);
    candidates.push(account);
  }
  // Account locks acquire a provider advisory lock first. Match import's order
  // across providers, independently of the user's requested membership order.
  candidates.sort((a, b) => a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1
    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const candidate of candidates) {
    await requireOwnedAccountForMutation(accounts, userId, candidate.id, eventing);
  }
}
