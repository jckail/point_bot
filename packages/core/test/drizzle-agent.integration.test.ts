import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AuthenticateAccessToken, IssueAccessToken } from "../src/application/agent/access-tokens";
import { GrantConsent, RevokeConsent } from "../src/application/agent/consents";
import { ResolveObservationReview, SubmitObservation } from "../src/application/agent/submit-observation";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { createDb } from "../src/infrastructure/db/client";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";
import { asUserId } from "./ids";

/**
 * Runs the agent bounded context against a real, migrated Postgres.
 * Opt in with TEST_DATABASE_URL (CI provides one):
 *   TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/app npm test
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("agent context on Postgres (Drizzle)", () => {
  let db: ReturnType<typeof createDb>;
  let repos: ReturnType<typeof buildDrizzleRepositories>;
  const clock = { now: () => new Date() };
  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Agent integration tests require the dedicated loopback postgres/app fixture.");
    }
    db = createDb(url!, { max: 6 });
    repos = buildDrizzleRepositories(db);
  });
  function eventing() {
    if (!repos.eventing) throw new Error("Missing production eventing.");
    return repos.eventing;
  }
  const userId = asUserId(`it-${crypto.randomUUID()}`);

  afterAll(async () => {
    if (!db) return;
    const { sql } = await import("drizzle-orm");
    try {
    for (const table of [
      "agent_observation",
      "domain_event_outbox",
      "consent_grant",
      "access_token",
      "balance_snapshot",
      "activity_event",
      "loyalty_account",
    ]) {
      await db.execute(
        table === "balance_snapshot"
          ? sql`delete from balance_snapshot where loyalty_account_id in (select id from loyalty_account where user_id=${userId})`
          : sql`delete from ${sql.identifier(table)} where user_id=${userId}`,
      );
    }
    } finally { await db.$client.end({ timeout: 5 }); }
  });

  it("round-trips tokens, consent, write-back, and the audit trail", async () => {
    const tokens = repos.accessTokens;
    const issued = await new IssueAccessToken(tokens).execute({
      userId,
      name: "integration",
      scopes: ["portfolio:read", "observations:write"],
    });
    const principal = await new AuthenticateAccessToken(tokens).execute(issued.plaintext);
    expect(principal).toMatchObject({ userId, scopes: ["portfolio:read", "observations:write"] });
    // The touch is fire-and-forget: wait for it instead of reading immediately.
    await vi.waitFor(async () =>
      expect((await tokens.findByUserId(userId))[0]?.lastUsedAt).toBeInstanceOf(Date),
    );

    const accounts = repos.loyaltyAccounts;
    const balances = repos.balanceSnapshots;
    const consents = repos.consents;
    const observations = repos.observations;
    const link = new LinkLoyaltyAccount(accounts, repos.activity, clock, eventing());
    const submit = new SubmitObservation(
      accounts,
      balances,
      consents,
      observations,
      new RecordManualBalance(accounts, balances, repos.activity, clock, eventing()),
      link,
      clock,
      eventing(),
    );
    const input = {
      userId,
      skillId: "united.capture-balance",
      sourceUrl: "https://www.united.com/en/us/myunited",
      agent: "integration",
      points: 12_345,
      membershipNumber: "IT123",
      canLinkAccount: true,
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

  it("concurrent grants leave exactly one open consent, and revoke clears it", async () => {
    const consents = repos.consents;
    const grant = new GrantConsent(consents);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        grant.execute({ userId, providerId: "delta", days: 7 }),
      ),
    );
    const rows = (await consents.findByUserId(userId)).filter(
      (c) => c.providerId === "delta",
    );
    expect(rows).toHaveLength(8);
    const open = rows.filter((c) => !c.revokedAt);
    expect(open).toHaveLength(1);
    expect(results.map((r) => r.id)).toContain(open[0]!.id);

    await new RevokeConsent(consents).execute(userId, open[0]!.id);
    expect((await consents.findByUserId(userId)).filter((c) => c.providerId === "delta" && !c.revokedAt)).toHaveLength(0);
  });

  it("holds an implausible reading, then a single-use review confirms it", async () => {
    const accounts = repos.loyaltyAccounts;
    const balances = repos.balanceSnapshots;
    const consents = repos.consents;
    const observations = repos.observations;
    const record = new RecordManualBalance(accounts, balances, repos.activity, clock, eventing());
    const submit = new SubmitObservation(
      accounts,
      balances,
      consents,
      observations,
      record,
      new LinkLoyaltyAccount(accounts, repos.activity, clock, eventing()),
      clock,
      eventing(),
    );
    const review = new ResolveObservationReview(accounts, balances, observations, record, clock, eventing());
    // Account/consent for "united" exist from the first test (balance 12,345).
    const held = await submit.execute({
      userId,
      skillId: "united.capture-balance",
      sourceUrl: "https://www.united.com/en/us/myunited",
      agent: "integration",
      points: 9_999_999,
    });
    expect(held).toMatchObject({ outcome: "needs_review", previousPoints: 12_345 });
    const [a, b] = await Promise.allSettled([
      review.confirm(userId, held.reviewId!),
      review.confirm(userId, held.reviewId!),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect((await balances.findByAccountId(held.accountId, 5))[0]).toMatchObject({
      points: 9_999_999,
      source: "agent",
    });
    await expect(review.reject(userId, held.reviewId!)).rejects.toMatchObject({
      code: "REVIEW_ALREADY_RESOLVED",
    });
  });
});
