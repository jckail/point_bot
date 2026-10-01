import { afterAll, describe, expect, it } from "vitest";

import { AuthenticateAccessToken, IssueAccessToken } from "../src/application/agent/access-tokens";
import { GrantConsent } from "../src/application/agent/consents";
import { SubmitObservation } from "../src/application/agent/submit-observation";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { createDb } from "../src/infrastructure/db/client";
import { DrizzleLoyaltyAccountRepository } from "../src/infrastructure/repositories/drizzle-loyalty-account-repository";
import {
  DrizzleAccessTokenRepository,
  DrizzleAgentObservationRepository,
  DrizzleConsentGrantRepository,
} from "../src/infrastructure/repositories/drizzle-agent-repositories";
import { DrizzleBalanceSnapshotRepository } from "../src/infrastructure/repositories/drizzle-loyalty-account-repository";

/**
 * Runs the agent bounded context against a real, migrated Postgres.
 * Opt in with TEST_DATABASE_URL (CI provides one):
 *   TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/app npm test
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("agent context on Postgres (Drizzle)", () => {
  const db = createDb(url ?? "postgresql://unused");
  const userId = `it-${crypto.randomUUID()}`;

  afterAll(async () => {
    const { sql } = await import("drizzle-orm");
    for (const table of [
      "agent_observation",
      "consent_grant",
      "access_token",
      "balance_snapshot",
      "activity_event",
      "loyalty_account",
    ]) {
      await db.execute(
        table === "balance_snapshot"
          ? sql.raw(`delete from balance_snapshot where loyalty_account_id in (select id from loyalty_account where user_id='${userId}')`)
          : sql.raw(`delete from ${table} where user_id='${userId}'`),
      );
    }
  });

  it("round-trips tokens, consent, write-back, and the audit trail", async () => {
    const tokens = new DrizzleAccessTokenRepository(db);
    const issued = await new IssueAccessToken(tokens).execute({
      userId,
      name: "integration",
      scopes: ["portfolio:read", "observations:write"],
    });
    const principal = await new AuthenticateAccessToken(tokens).execute(issued.plaintext);
    expect(principal).toMatchObject({ userId, scopes: ["portfolio:read", "observations:write"] });
    expect((await tokens.findByUserId(userId))[0]?.lastUsedAt).toBeInstanceOf(Date);

    const accounts = new DrizzleLoyaltyAccountRepository(db);
    const balances = new DrizzleBalanceSnapshotRepository(db);
    const consents = new DrizzleConsentGrantRepository(db);
    const observations = new DrizzleAgentObservationRepository(db);
    const link = new LinkLoyaltyAccount(accounts);
    const submit = new SubmitObservation(
      accounts,
      balances,
      consents,
      observations,
      new RecordManualBalance(accounts, balances),
      link,
    );
    const input = {
      userId,
      skillId: "united.capture-balance",
      sourceUrl: "https://www.united.com/en/us/myunited",
      agent: "integration",
      points: 12_345,
      membershipNumber: "IT123",
    };

    await expect(submit.execute(input)).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await new GrantConsent(consents).execute({ userId, providerId: "united", days: 1 });

    const result = await submit.execute(input);
    expect(result.outcome).toBe("recorded");
    expect((await balances.findByAccountId(result.accountId, 5))[0]).toMatchObject({
      points: 12_345,
      source: "agent",
    });
    expect((await submit.execute(input)).outcome).toBe("unchanged");
    expect((await observations.findByUserId(userId, 10)).map((o) => o.outcome)).toEqual([
      "unchanged",
      "recorded",
    ]);
  });
});
