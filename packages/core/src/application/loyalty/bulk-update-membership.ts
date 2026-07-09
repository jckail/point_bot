import { DomainError } from "../../domain/errors";
import type { UpdateLoyaltyAccount } from "./update-loyalty-account";

export interface BulkMembershipUpdate {
  readonly accountId: string;
  readonly membershipNumber: string;
}

export interface BulkUpdateFailure {
  readonly accountId: string;
  readonly code: string;
  readonly message: string;
}

export interface BulkUpdateMembershipResult {
  readonly updated: number;
  readonly failures: BulkUpdateFailure[];
}

/**
 * Applies membership-number changes to many accounts in one call, reusing the
 * single-account use case so ownership checks, invariants, and activity logging
 * stay in one place. Resilient: a failing item (e.g. an account the user does
 * not own) is recorded as a failure rather than aborting the whole batch;
 * unexpected non-domain errors still propagate.
 */
export class BulkUpdateMembershipNumbers {
  constructor(private readonly updateAccount: UpdateLoyaltyAccount) {}

  async execute(input: {
    readonly userId: string;
    readonly updates: readonly BulkMembershipUpdate[];
  }): Promise<BulkUpdateMembershipResult> {
    let updated = 0;
    const failures: BulkUpdateFailure[] = [];

    for (const update of input.updates) {
      try {
        await this.updateAccount.execute({
          userId: input.userId,
          accountId: update.accountId,
          membershipNumber: update.membershipNumber,
        });
        updated += 1;
      } catch (error) {
        if (error instanceof DomainError) {
          failures.push({
            accountId: update.accountId,
            code: error.code,
            message: error.message,
          });
        } else {
          throw error;
        }
      }
    }

    return { updated, failures };
  }
}
