import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SubmitObservation, ResolveObservationReview } from "../src/application/agent/submit-observation";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { createAccessToken } from "../src/domain/agent/access-token";
import { createConsentGrant } from "../src/domain/agent/consent";
import { UserId } from "../src/domain/shared/ids";
import { createDb } from "../src/infrastructure/db/client";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";

// Root owns applying migrations and running this disposable fixture. No DB activity when unset.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("selected transfer card through production consented capture and replay", () => {
  const prefix = `card-capture-${randomUUID()}`;
  const product = "chase-sapphire-preferred" as const;
  const providerId = "chase-ultimate-rewards" as const;
  let db: ReturnType<typeof createDb>;
  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Card capture tests require dedicated loopback postgres/app.");
    }
    db = createDb(url!, { max: 2 });
  });
  afterAll(async () => {
    if (!db) return;
    try {
      for (const table of ["agent_observation", "domain_event_outbox", "activity_event", "consent_grant", "access_token", "loyalty_account"]) {
        await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE user_id LIKE ${prefix + "%"}`);
      }
    } finally { await db.$client.end({ timeout: 5 }); }
  });
  async function fixture() {
    const userId = UserId.parse(`${prefix}-${randomUUID()}`);
    const now = new Date();
    const clock = { now: () => new Date(now) };
    const repos = buildDrizzleRepositories(db);
    const eventing = repos.eventing;
    if (!eventing) throw new Error("Card capture fixture requires production atomic eventing.");
    const link = new LinkLoyaltyAccount(repos.loyaltyAccounts, repos.activity, clock, eventing);
    const { accountId } = await link.execute({ userId, providerId, membershipNumber: "synthetic", cardProductId: product });
    const consent = createConsentGrant({ userId, providerId, now });
    await repos.consents.insert(consent);
    const { token } = await createAccessToken({ userId, name: "synthetic capture", scopes: ["observations:write"], now });
    await repos.accessTokens.insert(token);
    const record = new RecordManualBalance(repos.loyaltyAccounts, repos.balanceSnapshots, repos.activity, clock, eventing);
    const submit = new SubmitObservation(repos.loyaltyAccounts, repos.balanceSnapshots, repos.consents, repos.observations, record, link, clock, eventing);
    const review = new ResolveObservationReview(repos.loyaltyAccounts, repos.balanceSnapshots, repos.observations, record, clock, eventing);
    const input = {
      userId, skillId: `${providerId}.capture-balance`, sourceUrl: "https://ultimaterewardspoints.chase.com/",
      agent: "synthetic-card-capture", points: 40_000, observedAt: now, captureId: randomUUID(), sourceMethod: "page_capture" as const,
      credential: { kind: "personal_access_token" as const, tokenId: token.id },
    };
    const counts = async () => {
      const [row] = await db.$client<{ receipts: number; snapshots: number; events: number; activity: number }[]>`
        SELECT (SELECT count(*)::int FROM agent_observation WHERE user_id=${userId}) AS receipts,
          (SELECT count(*)::int FROM balance_snapshot WHERE loyalty_account_id=${accountId}) AS snapshots,
          (SELECT count(*)::int FROM domain_event_outbox WHERE user_id=${userId}) AS events,
          (SELECT count(*)::int FROM activity_event WHERE user_id=${userId}) AS activity`;
      if (!row) throw new Error("Missing card capture effect counts.");
      return row;
    };
    return { userId, accountId, repos, consent, token, submit, review, input, counts };
  }
  it("persists authenticated receipt and snapshot while preserving selection across exact replay", async () => {
    const f = await fixture();
    const before = await f.counts();
    const first = await f.submit.execute(f.input);
    expect(first).toMatchObject({ outcome: "recorded", accountId: f.accountId, points: 40_000 });
    expect(first.observationId).toBeDefined();
    const receipt = await f.repos.observations.findById(first.observationId!);
    expect(receipt).toMatchObject({ userId: f.userId, accountId: f.accountId, provenanceVersion: 1,
      credentialKind: "personal_access_token", accessTokenId: f.token.id, consentId: f.consent.id,
      captureId: f.input.captureId, sourceMethod: "page_capture", observedAt: f.input.observedAt, outcome: "recorded" });
    const snapshots = await f.repos.balanceSnapshots.findByAccountId(f.accountId, 10);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ id: receipt?.recordedSnapshotId, points: 40_000, source: "agent" });
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBe(product);
    const after = await f.counts();
    expect(after).toEqual({ receipts: before.receipts + 1, snapshots: before.snapshots + 1, events: before.events + 1, activity: before.activity + 1 });
    expect(await f.submit.execute(f.input)).toEqual(first);
    expect(await f.repos.observations.findById(first.observationId!)).toEqual(receipt);
    expect(await f.counts()).toEqual(after);
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBe(product);
  });
  it("denies foreign credentials and owner substitution without touching the selected card or receipt", async () => {
    const f = await fixture();
    const other = await fixture();
    const first = await f.submit.execute(f.input);
    const before = await f.counts();
    const otherBefore = await other.counts();
    await expect(f.submit.execute({ ...f.input, credential: { kind: "personal_access_token", tokenId: other.token.id } })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(f.submit.execute({ ...f.input, userId: other.userId })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(f.review.confirm(other.userId, first.observationId!)).rejects.toMatchObject({ code: "REVIEW_NOT_FOUND" });
    if (!f.repos.observations.findByCaptureId) throw new Error("Production capture lookup is required.");
    expect(await f.repos.observations.findByCaptureId(other.userId, f.input.captureId)).toBeNull();
    expect(await f.counts()).toEqual(before);
    expect(await other.counts()).toEqual(otherBefore);
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBe(product);
    expect((await other.repos.loyaltyAccounts.findById(other.accountId))?.cardProductId).toBe(product);
  });
});
