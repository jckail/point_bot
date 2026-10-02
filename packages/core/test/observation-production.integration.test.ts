import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SubmitObservation, ResolveObservationReview } from "../src/application/agent/submit-observation";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { createAccessToken } from "../src/domain/agent/access-token";
import { createConsentGrant } from "../src/domain/agent/consent";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { ObservationId, UserId } from "../src/domain/shared/ids";
import { createDb } from "../src/infrastructure/db/client";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";

// Disposable loopback fixture only; no client or network activity when unset.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("production-composed observation replay, locking and rollback", () => {
  const prefix = `observation-production-${randomUUID()}`;
  let db: ReturnType<typeof createDb>;
  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Observation tests require the dedicated loopback postgres/app fixture.");
    }
    db = createDb(url!, { max: 6 });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (!db) return;
    try {
      const pattern = prefix + "%";
      for (const table of ["agent_observation", "domain_event_outbox", "activity_event", "consent_grant", "access_token", "loyalty_account"]) {
        await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE user_id LIKE ${pattern}`);
      }
    } finally { await db.$client.end({ timeout: 5 }); }
  });

  async function fixture(linked = true) {
    const userId = UserId.parse(`${prefix}-${randomUUID()}`);
    let current = new Date();
    const clock = { now: () => new Date(current) };
    const repos = buildDrizzleRepositories(db);
    const eventing = repos.eventing;
    if (!eventing) throw new Error("Production fixture requires atomic eventing.");
    const account = createLoyaltyAccount({ userId, providerId: "united", membershipNumber: "synthetic", now: current });
    if (linked) await repos.loyaltyAccounts.insert(account);
    const consent = { ...createConsentGrant({ userId, providerId: "united", now: current }), expiresAt: new Date(current.getTime() + 60_000) };
    await repos.consents.insert(consent);
    const { token } = await createAccessToken({ userId, name: "synthetic", scopes: ["observations:write", "portfolio:write"], now: current });
    const expiringToken = { ...token, expiresAt: new Date(current.getTime() + 60_000) };
    await repos.accessTokens.insert(expiringToken);
    const record = new RecordManualBalance(repos.loyaltyAccounts, repos.balanceSnapshots, repos.activity, clock, eventing);
    const submit = new SubmitObservation(repos.loyaltyAccounts, repos.balanceSnapshots, repos.consents, repos.observations, record,
      new LinkLoyaltyAccount(repos.loyaltyAccounts, repos.activity, clock, eventing), clock, eventing);
    const review = new ResolveObservationReview(repos.loyaltyAccounts, repos.balanceSnapshots, repos.observations, record, clock, eventing);
    const input = { userId, skillId: "united.capture-balance", sourceUrl: "https://www.united.com/en/us/myunited", agent: "synthetic-fixture", points: 100,
      captureId: randomUUID(), sourceMethod: "page_capture" as const, credential: { kind: "personal_access_token" as const, tokenId: token.id } };
    const counts = async () => {
      const [row] = await db.$client<{ receipts: number; snapshots: number; events: number; activity: number }[]>`
        SELECT (SELECT count(*)::int FROM agent_observation WHERE user_id=${userId}) AS receipts,
          (SELECT count(*)::int FROM balance_snapshot WHERE loyalty_account_id IN (SELECT id FROM loyalty_account WHERE user_id=${userId})) AS snapshots,
          (SELECT count(*)::int FROM domain_event_outbox WHERE user_id=${userId}) AS events,
          (SELECT count(*)::int FROM activity_event WHERE user_id=${userId}) AS activity`;
      if (!row) throw new Error("Missing fixture effect counts.");
      return row;
    };
    return { userId, account, consent, token: expiringToken, repos, eventing, record, submit, review, input, counts, clock,
      advance: (milliseconds: number) => { current = new Date(current.getTime() + milliseconds); } };
  }

  async function blockRow(table: "loyalty_account" | "access_token" | "consent_grant", id: string, mutation?: string) {
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>(resolve => { acquired = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const finished = db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id=${id} FOR UPDATE`);
      acquired();
      await unlock;
      if (mutation) await tx.execute(sql`UPDATE ${sql.identifier(table)} SET ${sql.raw(mutation)} WHERE id=${id}`);
    });
    await held;
    return { release, finished };
  }

  async function waitForRowWait(table: "loyalty_account" | "access_token" | "consent_grant") {
    await vi.waitFor(async () => {
      const [row] = await db.$client<{ blocked: boolean }[]>`SELECT EXISTS(
        SELECT 1 FROM pg_locks WHERE NOT granted AND relation=${table}::regclass
      ) AS blocked`;
      // Row-lock waits can show as transactionid locks; the active query must
      // mention the intended table when that is how PostgreSQL reports it.
      const [activity] = await db.$client<{ blocked: boolean }[]>`SELECT EXISTS(
        SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE ${"%" + table + "%"}
      ) AS blocked`;
      expect(row?.blocked || activity?.blocked).toBe(true);
    }, { timeout: 3000, interval: 10 });
  }

  it("parallel exact retries produce one receipt, snapshot, activity and outbox event", async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 6 }, () => f.submit.execute(f.input)));
    expect(new Set(results.map(result => result.observationId)).size).toBe(1);
    expect(results.every(result => result.outcome === "recorded")).toBe(true);
    expect(await f.counts()).toEqual({ receipts: 1, snapshots: 1, events: 1, activity: 1 });
    const receipt = await f.repos.observations.findById(results[0]!.observationId!);
    expect(receipt).toMatchObject({ provenanceVersion: 1, credentialKind: "personal_access_token", accessTokenId: f.token.id,
      consentId: f.consent.id, sourceMethod: "page_capture", captureId: f.input.captureId });
    expect(receipt?.recordedSnapshotId).toBe((await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10))[0]?.id);
  });

  it("conflicts on changed claims, isolates owner namespaces, and replays across credential rotation", async () => {
    const f = await fixture();
    const first = await f.submit.execute(f.input);
    await expect(f.submit.execute({ ...f.input, points: 101 })).rejects.toMatchObject({ code: "OBSERVATION_REPLAY_CONFLICT" });
    const { token } = await createAccessToken({ userId: f.userId, name: "rotated", scopes: ["observations:write"], now: f.clock.now() });
    await f.repos.accessTokens.insert(token);
    expect(await f.submit.execute({ ...f.input, credential: { kind: "personal_access_token", tokenId: token.id } })).toEqual(first);
    expect((await f.repos.observations.findById(first.observationId!))?.accessTokenId).toBe(f.token.id);
    const other = await fixture();
    const independent = await other.submit.execute({ ...other.input, captureId: f.input.captureId });
    expect(independent.observationId).not.toBe(first.observationId);
    expect(await f.counts()).toEqual({ receipts: 1, snapshots: 1, events: 1, activity: 1 });
  });

  it("replays the original receipt after an intervening manual snapshot without new effects", async () => {
    const f = await fixture();
    const first = await f.submit.execute(f.input);
    const original = await f.repos.observations.findById(first.observationId!);
    f.advance(1000);
    await f.record.execute({ userId: f.userId, accountId: f.account.id, points: 300 });
    const before = await f.counts();
    expect(await f.submit.execute(f.input)).toEqual(first);
    expect(await f.counts()).toEqual(before);
    expect(await f.repos.observations.findById(first.observationId!)).toEqual(original);
    expect((await f.repos.balanceSnapshots.findLatestByAccountIds([f.account.id])).get(f.account.id)?.points).toBe(300);
  });

  it.each(["confirm", "reject"] as const)("replays a held receipt after %s and a later manual write", async decision => {
    const f = await fixture();
    const input = { ...f.input, points: 9_999_999 };
    const held = await f.submit.execute(input);
    const result = await f.review[decision](f.userId, held.reviewId!);
    const resolved = await f.repos.observations.findById(held.reviewId!);
    expect(resolved).toMatchObject({ accessTokenId: f.token.id, consentId: f.consent.id, reviewDecision: decision });
    f.advance(1000);
    await f.record.execute({ userId: f.userId, accountId: f.account.id, points: 300 });
    const before = await f.counts();
    expect(await f.submit.execute(input)).toEqual(result);
    expect(await f.counts()).toEqual(before);
    expect(await f.repos.observations.findById(held.reviewId!)).toEqual(resolved);
    expect((await f.repos.balanceSnapshots.findLatestByAccountIds([f.account.id])).get(f.account.id)?.points).toBe(300);
  });

  it.each(["access_token", "consent_grant"] as const)("rechecks %s revocation after waiting on its row", async table => {
    const f = await fixture();
    const id = table === "access_token" ? f.token.id : f.consent.id;
    const blocker = await blockRow(table, id, "revoked_at=now()");
    const result = f.submit.execute(f.input).then(() => null, (error: unknown) => error);
    try { await waitForRowWait(table); } finally { blocker.release(); await blocker.finished; }
    expect(await result).toMatchObject({ code: table === "access_token" ? "UNAUTHENTICATED" : "CONSENT_REQUIRED" });
    expect(await f.counts()).toEqual({ receipts: 0, snapshots: 0, events: 0, activity: 0 });
  });

  it.each(["access_token", "consent_grant"] as const)("rechecks live %s expiry after account lock waits", async table => {
    const f = await fixture();
    if (table === "access_token") await f.repos.consents.update({ ...f.consent, expiresAt: new Date(f.clock.now().getTime() + 120_000) });
    else await f.repos.accessTokens.update({ ...f.token, expiresAt: new Date(f.clock.now().getTime() + 120_000) });
    const blocker = await blockRow("loyalty_account", f.account.id);
    const result = f.submit.execute(f.input).then(() => null, (error: unknown) => error);
    try { await waitForRowWait("loyalty_account"); f.advance(60_000); } finally { blocker.release(); await blocker.finished; }
    expect(await result).toMatchObject({ code: table === "access_token" ? "UNAUTHENTICATED" : "CONSENT_REQUIRED" });
    expect(await f.counts()).toEqual({ receipts: 0, snapshots: 0, events: 0, activity: 0 });
  });

  it("rejects account deletion committed while submission waits", async () => {
    const f = await fixture();
    const blocker = await blockRow("loyalty_account", f.account.id, "deleted_at=now()");
    const result = f.submit.execute(f.input).then(() => null, (error: unknown) => error);
    try { await waitForRowWait("loyalty_account"); } finally { blocker.release(); await blocker.finished; }
    expect(await result).toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    expect(await f.counts()).toEqual({ receipts: 0, snapshots: 0, events: 0, activity: 0 });
  });

  it("uses fresh PAT scope for auto-link rather than stale HTTP permission", async () => {
    const f = await fixture(false);
    await f.repos.accessTokens.update({ ...f.token, scopes: ["observations:write"] });
    await expect(f.submit.execute({ ...f.input, canLinkAccount: true, membershipNumber: "synthetic" })).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    expect(await f.repos.loyaltyAccounts.findByUserId(f.userId)).toHaveLength(0);
    expect(await f.counts()).toEqual({ receipts: 0, snapshots: 0, events: 0, activity: 0 });
  });

  it("binds held review to snapshot identity even when points remain identical", async () => {
    const f = await fixture();
    const baseline = createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 100, source: "manual", capturedAt: new Date(f.clock.now().getTime() - 2000) });
    await f.repos.balanceSnapshots.insert(baseline);
    const held = await f.submit.execute({ ...f.input, points: 9_999_999 });
    expect(held.outcome).toBe("needs_review");
    await f.repos.balanceSnapshots.insert(createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 100, source: "sync", capturedAt: new Date(f.clock.now().getTime() - 1000) }));
    await expect(f.review.confirm(f.userId, held.reviewId!)).rejects.toMatchObject({ code: "REVIEW_STALE" });
    expect((await f.repos.observations.findById(held.reviewId!))?.outcome).toBe("needs_review");
    expect((await f.counts()).snapshots).toBe(2);
  });

  it("serializes direct snapshot writers ahead of confirmation baseline checks", async () => {
    const f = await fixture();
    await f.repos.balanceSnapshots.insert(createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 100, source: "manual", capturedAt: new Date(f.clock.now().getTime() - 2000) }));
    const held = await f.submit.execute({ ...f.input, points: 9_999_999 });
    const blocker = await blockRow("loyalty_account", f.account.id);
    const writing = f.repos.balanceSnapshots.insert(createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 100, source: "sync", capturedAt: new Date(f.clock.now().getTime() - 1000) }));
    let confirming: Promise<unknown> | undefined;
    try {
      await waitForRowWait("loyalty_account");
      // The writer now owns the provider advisory lock and waits on the row;
      // confirmation must queue behind it before inspecting its baseline.
      confirming = f.review.confirm(f.userId, held.reviewId!).then(() => null, (error: unknown) => error);
    } finally { blocker.release(); await blocker.finished; }
    await writing;
    expect(await confirming).toMatchObject({ code: "REVIEW_STALE" });
    expect((await f.repos.observations.findById(held.reviewId!))?.outcome).toBe("needs_review");
    expect(await f.counts()).toEqual({ receipts: 1, snapshots: 2, events: 1, activity: 0 });
  });

  it.each([false, true])("keeps legacy nullable baseline receipts compatible (changed points: %s)", async changed => {
    const f = await fixture();
    await f.repos.balanceSnapshots.insert(createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 100, source: "manual", capturedAt: new Date(f.clock.now().getTime() - 2000) }));
    const id = ObservationId.generate();
    await f.repos.observations.insert({ id, userId: f.userId, accountId: f.account.id, providerId: "united", skillId: f.input.skillId,
      agent: "legacy-fixture", sourceHost: "www.united.com", points: 9_999_999, previousPoints: 100, outcome: "needs_review",
      observedAt: f.clock.now(), createdAt: f.clock.now(), provenanceVersion: 0, payloadHash: null, baselineSnapshotId: null });
    if (changed) {
      await f.repos.balanceSnapshots.insert(createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 200, source: "sync", capturedAt: new Date(f.clock.now().getTime() - 1000) }));
      await expect(f.review.confirm(f.userId, id)).rejects.toMatchObject({ code: "REVIEW_STALE" });
      expect((await f.repos.observations.findById(id))?.outcome).toBe("needs_review");
      expect(await f.counts()).toEqual({ receipts: 1, snapshots: 2, events: 0, activity: 0 });
    } else {
      expect((await f.review.confirm(f.userId, id)).outcome).toBe("recorded");
      expect(await f.counts()).toEqual({ receipts: 1, snapshots: 2, events: 2, activity: 1 });
    }
  });

  it("concurrent confirm/reject has one resolution and at most one balance", async () => {
    const f = await fixture();
    const held = await f.submit.execute({ ...f.input, points: 9_999_999 });
    const results = await Promise.allSettled([f.review.confirm(f.userId, held.reviewId!), f.review.reject(f.userId, held.reviewId!)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const receipt = await f.repos.observations.findById(held.reviewId!);
    if (receipt?.outcome === "recorded") expect(await f.counts()).toEqual({ receipts: 1, snapshots: 1, events: 3, activity: 1 });
    else {
      expect(receipt?.outcome).toBe("rejected");
      expect(await f.counts()).toEqual({ receipts: 1, snapshots: 0, events: 2, activity: 0 });
    }
  });

  it("cannot confirm after its expiry crosses while waiting for the account", async () => {
    const f = await fixture();
    const held = await f.submit.execute({ ...f.input, points: 9_999_999 });
    const before = await f.counts();
    const blocker = await blockRow("loyalty_account", f.account.id);
    const result = f.review.confirm(f.userId, held.reviewId!).then(() => null, (error: unknown) => error);
    try { await waitForRowWait("loyalty_account"); f.advance(24 * 3_600_000); } finally { blocker.release(); await blocker.finished; }
    expect(await result).toMatchObject({ code: "REVIEW_EXPIRED" });
    expect(await f.counts()).toEqual(before);
    expect((await f.repos.observations.findById(held.reviewId!))?.outcome).toBe("needs_review");
  });

  it("rolls back balance, activity, receipt and outbox after receipt insertion fails", async () => {
    const f = await fixture();
    const insert = f.repos.observations.insert.bind(f.repos.observations);
    const fault = vi.spyOn(f.repos.observations, "insert").mockImplementationOnce(async receipt => {
      await insert(receipt);
      throw new Error("Synthetic receipt failure");
    });
    try { await expect(f.submit.execute(f.input)).rejects.toThrow("Synthetic receipt failure"); }
    finally { fault.mockRestore(); }
    expect(await f.counts()).toEqual({ receipts: 0, snapshots: 0, events: 0, activity: 0 });
  });

  it("rolls back confirmed snapshot and receipt when the confirmation outbox write fails", async () => {
    const f = await fixture();
    const held = await f.submit.execute({ ...f.input, points: 9_999_999 });
    const before = await f.counts();
    const publish = f.eventing.publisher.publish.bind(f.eventing.publisher);
    const fault = vi.spyOn(f.eventing.publisher, "publish").mockImplementation(async events => {
      await publish(events);
      if (events.some(event => event.type === "observation.confirmed")) throw new Error("Synthetic confirmation outbox failure");
    });
    try { await expect(f.review.confirm(f.userId, held.reviewId!)).rejects.toThrow("Synthetic confirmation outbox failure"); }
    finally { fault.mockRestore(); }
    expect(await f.counts()).toEqual(before);
    expect((await f.repos.observations.findById(held.reviewId!))?.outcome).toBe("needs_review");
  });

  it("rolls back confirmation when its publisher crosses the deadline after snapshot and transition", async () => {
    const f = await fixture();
    const held = await f.submit.execute({ ...f.input, points: 9_999_999 });
    const original = await f.repos.observations.findById(held.reviewId!);
    const before = await f.counts();
    const publish = f.eventing.publisher.publish.bind(f.eventing.publisher);
    const fault = vi.spyOn(f.eventing.publisher, "publish").mockImplementation(async events => {
      await publish(events);
      if (events.some(event => event.type === "observation.confirmed")) {
        const staged = await f.repos.observations.findById(held.reviewId!);
        expect(staged?.outcome).toBe("recorded");
        expect((await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).some(snapshot => snapshot.id === staged?.recordedSnapshotId)).toBe(true);
        f.advance(24 * 3_600_000);
      }
    });
    try { await expect(f.review.confirm(f.userId, held.reviewId!)).rejects.toMatchObject({ code: "REVIEW_EXPIRED" }); }
    finally { fault.mockRestore(); }
    expect(await f.counts()).toEqual(before);
    expect(await f.repos.observations.findById(held.reviewId!)).toEqual(original);
  });

  it("sync reloads manual baseline and account metadata after provider IO and a row wait", async () => {
    const f = await fixture();
    let fetched!: () => void;
    let releaseFetch!: () => void;
    const started = new Promise<void>(resolve => { fetched = resolve; });
    const ready = new Promise<void>(resolve => { releaseFetch = resolve; });
    const sync = new SyncLoyaltyAccount(f.repos.loyaltyAccounts, f.repos.balanceSnapshots,
      { supports: () => true, fetchBalance: async () => { fetched(); await ready; return { points: 200 }; } },
      { resolve: async () => null }, f.repos.activity, f.clock, f.eventing);
    const syncing = sync.execute({ userId: f.userId, accountId: f.account.id });
    await started;
    f.advance(1000);
    await f.record.execute({ userId: f.userId, accountId: f.account.id, points: 50 });
    const current = await f.repos.loyaltyAccounts.findById(f.account.id);
    if (!current) throw new Error("Missing sync fixture account.");
    await f.repos.loyaltyAccounts.update({ ...current, notes: "Updated during provider IO", tags: ["fresh metadata"], pinnedAt: f.clock.now() });
    const blocker = await blockRow("loyalty_account", f.account.id, "notes='Committed after lock wait'");
    try {
      f.advance(1000);
      releaseFetch();
      await waitForRowWait("loyalty_account");
    } finally { blocker.release(); await blocker.finished; }
    expect(await syncing).toMatchObject({ points: 200, source: "sync" });
    expect(await f.repos.loyaltyAccounts.findById(f.account.id)).toMatchObject({ notes: "Committed after lock wait", tags: ["fresh metadata"], pinnedAt: current.updatedAt });
    const events = await db.$client<{ payload: { source: string; points: number; previousPoints: number | null } }[]>`SELECT payload FROM domain_event_outbox WHERE user_id=${f.userId} AND type='balance.recorded'`;
    expect(events.find(event => event.payload.source === "sync")?.payload).toMatchObject({ points: 200, previousPoints: 50 });
    expect(await f.counts()).toEqual({ receipts: 0, snapshots: 2, events: 2, activity: 2 });
  });

  it("rolls back completed effects when locked consent expires at the final boundary", async () => {
    const f = await fixture();
    await f.repos.accessTokens.update({ ...f.token, expiresAt: new Date(f.clock.now().getTime() + 120_000) });
    const insert = f.repos.observations.insert.bind(f.repos.observations);
    const fault = vi.spyOn(f.repos.observations, "insert").mockImplementationOnce(async receipt => {
      await insert(receipt);
      f.advance(60_000);
    });
    try { await expect(f.submit.execute(f.input)).rejects.toMatchObject({ code: "CONSENT_REQUIRED" }); }
    finally { fault.mockRestore(); }
    expect(await f.counts()).toEqual({ receipts: 0, snapshots: 0, events: 0, activity: 0 });
  });

  it("retains credential/grant witnesses after their rows are purged", async () => {
    const f = await fixture();
    const result = await f.submit.execute(f.input);
    await db.$client`DELETE FROM access_token WHERE id=${f.token.id}`;
    await db.$client`DELETE FROM consent_grant WHERE id=${f.consent.id}`;
    expect(await f.repos.observations.findById(result.observationId!)).toMatchObject({ accessTokenId: f.token.id, consentId: f.consent.id, consentGrantedAt: f.consent.grantedAt, consentExpiresAt: f.consent.expiresAt });
    expect(await f.counts()).toEqual({ receipts: 1, snapshots: 1, events: 1, activity: 1 });
  });
});
