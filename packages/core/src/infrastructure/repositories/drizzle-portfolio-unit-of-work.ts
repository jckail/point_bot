import { sql } from "drizzle-orm";
import type { PortfolioTransaction, PortfolioUnitOfWork } from "../../application/loyalty/portfolio-unit-of-work";
import type { Database } from "../db/client";
import { DrizzleActivityEventRepository, DrizzleBalanceSnapshotRepository, DrizzleLoyaltyAccountRepository } from "./drizzle-loyalty-account-repository";

/** Transactions own scoped repositories; no mutation uses the outer connection. */
export class DrizzlePortfolioUnitOfWork implements PortfolioUnitOfWork {
  constructor(private readonly db: Database) {}

  async run<T>(userId: string, operation: (repositories: PortfolioTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      // Serialize imports for an owner before identity preflight. Hash collisions
      // only serialize unrelated owners; they never change access predicates.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"pointup:portfolio:" + userId}, 0))`);
      return operation({
        accounts: new DrizzleLoyaltyAccountRepository(tx, true),
        balances: new DrizzleBalanceSnapshotRepository(tx),
        activity: new DrizzleActivityEventRepository(tx),
      });
    });
  }
}
