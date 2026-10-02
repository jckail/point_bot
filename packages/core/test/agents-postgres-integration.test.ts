import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../src/infrastructure/db/schema";
import { DrizzleAgentObservationRepository, DrizzleAgentTokenRepository, DrizzleObservationConsentRepository } from "../src/infrastructure/repositories/drizzle-agent-repositories";
import { DrizzleBalanceSnapshotRepository, DrizzleLoyaltyAccountRepository, DrizzleTripGoalRepository } from "../src/infrastructure/repositories/drizzle-loyalty-account-repository";
import { AuthenticateAgentToken, GrantObservationConsent, MintAgentToken, RevokeAgentToken, RevokeObservationConsent, ReviewAgentObservation, SubmitAgentObservation } from "../src/application/agents/manage-agents";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { DrizzleAssistantActionRepository } from "../src/infrastructure/assistant/drizzle-action-repository";
import { ManageAssistantActions } from "../src/application/assistant/manage-actions";
import { GetLoyaltyAccount } from "../src/application/loyalty/get-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import type { AssistantAction } from "../src/domain/assistant/actions";
import type { SubmitObservationInput } from "../src/domain/agents/models";
const url = process.env.DATABASE_INTEGRATION_URL;
const suite = url ? describe : describe.skip;
const NOW = new Date("2026-10-01T12:00:00Z");
const clock = { now: () => NOW };
suite("durable agent PostgreSQL fixture", () => {
  const owner = `agent-fixture-${randomUUID()}`;
  const browserRole = `agent_browser_${randomUUID().replaceAll("-", "")}`;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let tokens: DrizzleAgentTokenRepository;
  let consents: DrizzleObservationConsentRepository;
  let observations: DrizzleAgentObservationRepository;
  let accounts: DrizzleLoyaltyAccountRepository;
  let balances: DrizzleBalanceSnapshotRepository;
  let actions: DrizzleAssistantActionRepository;
  let roleCreated = false;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/pointup_integration" || parsed.username !== "pointup_fixture") throw new Error("Dedicated loopback pointup_fixture/pointup_integration database required");
    sql = postgres(url!, { max: 6, connect_timeout: 10, onnotice: () => {} });
    db = drizzle(sql, { schema });
    const lease = await sql.reserve();
    await lease`SELECT pg_advisory_lock(846795951)`;
    try {
      // Verify safe adoption of an installation that used standalone SIWC SQL.
      await sql.unsafe(await readFile(new URL("../../../apps/web/src/server/chatgpt/storage.sql", import.meta.url), "utf8"));
      await sql`INSERT INTO pointup_chatgpt_identities (issuer, client_id, subject, clerk_user_id) VALUES (${owner}, 'legacy-fixture', 'legacy-subject', ${owner})`;
      await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    } finally { await lease`SELECT pg_advisory_unlock(846795951)`; lease.release(); }
    actions = new DrizzleAssistantActionRepository(db);
    tokens = new DrizzleAgentTokenRepository(db, clock); consents = new DrizzleObservationConsentRepository(db); observations = new DrizzleAgentObservationRepository(db, clock);
    accounts = new DrizzleLoyaltyAccountRepository(db); balances = new DrizzleBalanceSnapshotRepository(db);
    await sql.unsafe(`CREATE ROLE ${browserRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`); roleCreated = true;
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${browserRole}`);
  }, 30_000);
  afterAll(async () => {
    if (!sql) return;
    try {
      if (!roleCreated) return;
      await sql`DELETE FROM assistant_action WHERE user_id LIKE ${owner + "%"}`;
      await sql`DELETE FROM activity_event WHERE user_id LIKE ${owner + "%"}`;
      await sql`DELETE FROM loyalty_account WHERE user_id LIKE ${owner + "%"}`;
      await sql`DELETE FROM agent_token WHERE user_id LIKE ${owner + "%"}`;
      await sql`DELETE FROM pointup_chatgpt_identities WHERE issuer = ${owner}`;
      await sql.unsafe(`DROP OWNED BY ${browserRole}`); await sql.unsafe(`DROP ROLE ${browserRole}`);
    } finally { await sql.end({ timeout: 5 }); }
  });
  async function setup(providerId = "united", previous?: number, scopes: ("observations:write" | "portfolio:read")[] = ["observations:write"]) {
    let currentTime = NOW;
    const fixtureClock = { now: () => currentTime };
    const fixtureTokens = new DrizzleAgentTokenRepository(db, fixtureClock);
    const fixtureObservations = new DrizzleAgentObservationRepository(db, fixtureClock);
    const userId = `${owner}-${randomUUID()}`;
    const account = createLoyaltyAccount({ userId, providerId, membershipNumber: "fixture-member", now: NOW }); await accounts.insert(account);
    if (previous !== undefined) await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: previous, source: "manual", capturedAt: new Date(NOW.getTime() - 1000) }));
    const minted = await new MintAgentToken(fixtureTokens, fixtureClock).execute({ userId, label: "Fixture agent", scopes, expiresAt: new Date(NOW.getTime() + 86400_000) });
    const consent = await new GrantObservationConsent(consents, accounts, clock).execute({ userId, accountId: account.id, expiresAt: new Date(NOW.getTime() + 3600_000) });
    const input: SubmitObservationInput = { userId, tokenId: minted.metadata.id, observationId: randomUUID(), accountId: account.id, providerId, points: previous ?? 100, capturedAt: NOW, sourceUrl: `https://www.${providerId === "american" ? "aa" : providerId}.com/account?private=not-retained`, sourceMethod: "page_capture" };
    return { userId, account, minted, consent, input, fixtureTokens,
      authenticate: new AuthenticateAgentToken(fixtureTokens, fixtureClock),
      advanceTo: (time: Date) => { currentTime = time; },
      submit: new SubmitAgentObservation(fixtureObservations, accounts, consents, fixtureClock), review: new ReviewAgentObservation(observations, accounts, clock) };
  }
  // Observe actual PostgreSQL lock waits before changing time or releasing the
  // holder. Promise handling is installed immediately so rejection is never lost.
  async function heldLock(table: "agent_token" | "loyalty_account" | "observation_consent" | "agent_observation" | "balance_snapshot", id: string,
    run: (waitForBlocked: LockWait) => Promise<void>) {
    const holder = await sql.reserve();
    await holder`BEGIN`;
    try {
      const [backend] = await holder`SELECT pg_backend_pid() AS pid`;
      if (table === "balance_snapshot") await holder`LOCK TABLE balance_snapshot IN SHARE MODE`;
      else await holder.unsafe(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      let released = false;
      const waitForBlocked = async (count = 1) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const [result] = await sql`WITH RECURSIVE blocked(pid) AS (
            SELECT pid FROM pg_stat_activity WHERE ${backend!.pid} = ANY(pg_blocking_pids(pid))
            UNION
            SELECT activity.pid FROM pg_stat_activity activity JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
          ) SELECT count(*)::int AS count FROM blocked`;
          if (Number(result!.count) >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Expected ${count} PostgreSQL requests blocked by fixture row lock`);
      };
      // The callback must release before awaiting blocked operations.
      await run(Object.assign(waitForBlocked, { release: async () => { await holder`COMMIT`; released = true; } }));
      if (!released) throw new Error("Fixture lock was not released");
    } finally {
      await holder`ROLLBACK`;
      holder.release();
    }
  }
  type LockWait = ((count?: number) => Promise<void>) & { release: () => Promise<void> };
  const outcome = <T>(promise: Promise<T>) => promise.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
  async function expectNoObservationWrites(fixture: Awaited<ReturnType<typeof setup>>) {
    expect(await observations.findByUserId(fixture.userId)).toHaveLength(0);
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(0);
    expect(await sql`SELECT id FROM activity_event WHERE user_id = ${fixture.userId}`).toHaveLength(0);
  }
  it("rejects authentication when its token expires during a confirmed token lock wait", async () => {
    const fixture = await setup();
    await heldLock("agent_token", fixture.minted.metadata.id, async (wait) => {
      const pending = outcome(fixture.authenticate.execute(fixture.minted.token));
      await wait();
      fixture.advanceTo(fixture.minted.metadata.expiresAt);
      await wait.release();
      expect((await pending).error).toMatchObject({ code: "AGENT_TOKEN_INVALID" });
    });
    const [stored] = await sql`SELECT last_used_at FROM agent_token WHERE id = ${fixture.minted.metadata.id}`;
    expect(stored!.last_used_at).toBeNull();
    await expectNoObservationWrites(fixture);
  });
  it("records the post-lock authentication time while an unexpired token remains usable", async () => {
    const fixture = await setup();
    const resumedAt = new Date(NOW.getTime() + 60_000);
    await heldLock("agent_token", fixture.minted.metadata.id, async (wait) => {
      const pending = outcome(fixture.authenticate.execute(fixture.minted.token));
      await wait();
      fixture.advanceTo(resumedAt);
      await wait.release();
      expect((await pending).value).toMatchObject({ tokenId: fixture.minted.metadata.id });
    });
    const [stored] = await sql`SELECT last_used_at FROM agent_token WHERE id = ${fixture.minted.metadata.id}`;
    expect(new Date(stored!.last_used_at as string)).toEqual(resumedAt);
  });
  it.each([
    ["token", "agent_token"],
    ["token", "loyalty_account"],
    ["token", "observation_consent"],
    ["consent", "observation_consent"],
  ] as const)("rejects ingestion when %s expires during a confirmed %s lock wait", async (expiry, table) => {
    const fixture = await setup();
    const id = table === "agent_token" ? fixture.minted.metadata.id : table === "loyalty_account" ? fixture.account.id : fixture.consent.id;
    await heldLock(table, id, async (wait) => {
      const pending = outcome(fixture.submit.execute(fixture.input));
      await wait();
      fixture.advanceTo(expiry === "token" ? fixture.minted.metadata.expiresAt : fixture.consent.expiresAt);
      await wait.release();
      expect((await pending).error).toMatchObject({ code: expiry === "token" ? "AGENT_TOKEN_INVALID" : "OBSERVATION_CONSENT_REQUIRED" });
    });
    await expectNoObservationWrites(fixture);
  });
  it.each(["token", "consent"] as const)("rolls back every write when %s expires during a confirmed snapshot insert lock wait", async (expiry) => {
    const fixture = await setup();
    await heldLock("balance_snapshot", fixture.account.id, async (wait) => {
      const pending = outcome(fixture.submit.execute(fixture.input));
      await wait();
      fixture.advanceTo(expiry === "token" ? fixture.minted.metadata.expiresAt : fixture.consent.expiresAt);
      await wait.release();
      expect((await pending).error).toMatchObject({ code: expiry === "token" ? "AGENT_TOKEN_INVALID" : "OBSERVATION_CONSENT_REQUIRED" });
    });
    await expectNoObservationWrites(fixture);
  });
  it.each(["token", "consent"] as const)("revalidates %s expiry before returning a replay blocked on its receipt", async (expiry) => {
    const fixture = await setup();
    await fixture.submit.execute(fixture.input);
    await heldLock("agent_observation", fixture.input.observationId, async (wait) => {
      const pending = outcome(fixture.submit.execute(fixture.input));
      await wait();
      fixture.advanceTo(expiry === "token" ? fixture.minted.metadata.expiresAt : fixture.consent.expiresAt);
      await wait.release();
      expect((await pending).error).toMatchObject({ code: expiry === "token" ? "AGENT_TOKEN_INVALID" : "OBSERVATION_CONSENT_REQUIRED" });
    });
    expect(await observations.findByUserId(fixture.userId)).toHaveLength(1);
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(1);
    expect(await sql`SELECT id FROM activity_event WHERE user_id = ${fixture.userId}`).toHaveLength(1);
  });
  it.each(["token", "consent"] as const)("denies an existing receipt replay queued behind concurrent %s revocation", async (grant) => {
    const fixture = await setup();
    await fixture.submit.execute(fixture.input);
    await heldLock(grant === "token" ? "agent_token" : "observation_consent", grant === "token" ? fixture.minted.metadata.id : fixture.consent.id, async (wait) => {
      const revoked = outcome(grant === "token"
        ? new RevokeAgentToken(fixture.fixtureTokens, clock).execute({ userId: fixture.userId, tokenId: fixture.minted.metadata.id })
        : new RevokeObservationConsent(consents, clock).execute({ userId: fixture.userId, consentId: fixture.consent.id }));
      await wait();
      const replay = outcome(fixture.submit.execute(fixture.input));
      await wait(2);
      await wait.release();
      expect((await revoked).error).toBeUndefined();
      expect((await replay).error).toMatchObject({ code: grant === "token" ? "AGENT_TOKEN_INVALID" : "OBSERVATION_CONSENT_REQUIRED" });
    });
    expect(await observations.findByUserId(fixture.userId)).toHaveLength(1);
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(1);
    expect(await sql`SELECT id FROM activity_event WHERE user_id = ${fixture.userId}`).toHaveLength(1);
  }, 15_000);
  it("adopts existing SIWC identities and manages all six private tables", async () => {
    expect(await sql`SELECT subject FROM pointup_chatgpt_identities WHERE issuer = ${owner}`).toHaveLength(1);
    const rows = await sql`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('agent_token','observation_consent','agent_observation','assistant_action','pointup_chatgpt_identities','pointup_chatgpt_transactions')`;
    expect(rows).toHaveLength(6); expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });
  it("stores only token hashes and persists last-use/expiry/revocation across repository instances", async () => {
    const fixture = await setup(); const auth = new AuthenticateAgentToken(tokens, clock);
    await auth.execute(fixture.minted.token, "observations:write");
    const [stored] = await sql`SELECT * FROM agent_token WHERE id = ${fixture.minted.metadata.id}`;
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(stored)).not.toContain(fixture.minted.token);
    expect(new Date(stored?.last_used_at as string)).toEqual(NOW);
    const reader = await setup("delta", undefined, ["portfolio:read"]);
    await expect(auth.execute(reader.minted.token, "observations:write")).rejects.toMatchObject({ code: "AGENT_SCOPE_DENIED" });
    await expect(new AuthenticateAgentToken(tokens, { now: () => fixture.minted.metadata.expiresAt }).execute(fixture.minted.token)).rejects.toMatchObject({ code: "AGENT_TOKEN_INVALID" });
    await expect(new RevokeAgentToken(tokens, clock).execute({ userId: "wrong-owner", tokenId: fixture.minted.metadata.id })).rejects.toMatchObject({ code: "AGENT_RECORD_NOT_FOUND" });
    await new RevokeAgentToken(tokens, clock).execute({ userId: fixture.userId, tokenId: fixture.minted.metadata.id });
    const secondClient = postgres(url!, { max: 1 });
    try { await expect(new AuthenticateAgentToken(new DrizzleAgentTokenRepository(drizzle(secondClient, { schema }), clock), clock).execute(fixture.minted.token)).rejects.toMatchObject({ code: "AGENT_TOKEN_INVALID" }); }
    finally { await secondClient.end({ timeout: 5 }); }
  });
  it("requires active owned consent and write scope at the atomic persistence boundary", async () => {
    const fixture = await setup();
    await new RevokeObservationConsent(consents, clock).execute({ userId: fixture.userId, consentId: fixture.consent.id });
    await expect(fixture.submit.execute(fixture.input)).rejects.toMatchObject({ code: "OBSERVATION_CONSENT_REQUIRED" });
    await expect(new GrantObservationConsent(consents, accounts, clock).execute({ userId: "wrong-owner", accountId: fixture.account.id, expiresAt: new Date(NOW.getTime() + 1000) })).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    const reader = await setup("delta", undefined, ["portfolio:read"]);
    await expect(reader.submit.execute(reader.input)).rejects.toMatchObject({ code: "AGENT_SCOPE_DENIED" });
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(0);
    const expired = await setup("hyatt");
    await expect(new SubmitAgentObservation(observations, accounts, consents, { now: () => expired.consent.expiresAt }).execute(expired.input)).rejects.toMatchObject({ code: "OBSERVATION_CONSENT_REQUIRED" });
  });
  it("idempotently commits one snapshot and audit row under concurrent duplicate submissions", async () => {
    const fixture = await setup();
    const result = await Promise.all([1,2,3,4].map(() => fixture.submit.execute(fixture.input)));
    expect(result.every((record) => record.status === "accepted")).toBe(true);
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(1);
    expect(await observations.findByUserId(fixture.userId)).toHaveLength(1);
    expect(await sql`SELECT id FROM activity_event WHERE user_id = ${fixture.userId}`).toHaveLength(1);
    await expect(fixture.submit.execute({ ...fixture.input, points: 101 })).rejects.toMatchObject({ code: "OBSERVATION_CONFLICT" });
    await expect(fixture.submit.execute({ ...fixture.input, sourceUrl: "https://www.united.com/account?private=changed" })).rejects.toMatchObject({ code: "OBSERVATION_CONFLICT" });
    const rows = await sql`SELECT * FROM agent_observation WHERE user_id = ${fixture.userId}`;
    expect(JSON.stringify(rows)).not.toContain("private=");
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(1);
  });
  it("holds >=10x observations until one owned review commits exactly one snapshot", async () => {
    const fixture = await setup("hyatt", 100);
    expect((await fixture.submit.execute({ ...fixture.input, points: 1000 })).status).toBe("held");
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(1);
    await expect(fixture.review.execute({ userId: "wrong-owner", observationId: fixture.input.observationId, decision: "approve" })).rejects.toMatchObject({ code: "AGENT_RECORD_NOT_FOUND" });
    const reviews = await Promise.all([1,2,3].map(() => fixture.review.execute({ userId: fixture.userId, observationId: fixture.input.observationId, decision: "approve" })));
    expect(reviews.every((record) => record.status === "accepted")).toBe(true);
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(2);
    await expect(fixture.review.execute({ userId: fixture.userId, observationId: fixture.input.observationId, decision: "reject" })).rejects.toMatchObject({ code: "OBSERVATION_CONFLICT" });
    const rejected = await setup("hilton", 1000); await rejected.submit.execute({ ...rejected.input, points: 0 });
    expect((await rejected.review.execute({ userId: rejected.userId, observationId: rejected.input.observationId, decision: "reject" })).status).toBe("rejected");
    expect(await balances.findByAccountId(rejected.account.id, 10)).toHaveLength(1);
  });
  it("enforces same-owner/provider foreign keys even for direct database writes", async () => {
    const fixture = await setup();
    await expect(sql`INSERT INTO observation_consent (id,user_id,account_id,provider_id,granted_at,expires_at) VALUES (${randomUUID()}, 'wrong-owner', ${fixture.account.id}, 'united', ${NOW.toISOString()}, ${new Date(NOW.getTime()+1000).toISOString()})`).rejects.toMatchObject({ code: "23503" });
    await expect(sql`INSERT INTO observation_consent (id,user_id,account_id,provider_id,granted_at,expires_at) VALUES (${randomUUID()}, ${fixture.userId}, ${fixture.account.id}, 'delta', ${NOW.toISOString()}, ${new Date(NOW.getTime()+1000).toISOString()})`).rejects.toMatchObject({ code: "23503" });
  });
  it("denies private agent tables to a nonprivileged role despite SELECT grants", async () => {
    await sql.unsafe(`GRANT SELECT ON agent_token, observation_consent, agent_observation, assistant_action TO ${browserRole}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${browserRole}`);
      for (const table of ["agent_token", "observation_consent", "agent_observation", "assistant_action"]) expect(await tx.unsafe(`SELECT * FROM ${table}`)).toHaveLength(0);
    });
  });

  function actionRecord(userId = owner): AssistantAction {
    return { id: `action_fixture_${randomUUID()}`, userId, kind: "manual_balance", payload: { accountId: randomUUID(), providerId: "hyatt", providerName: "World of Hyatt", points: 100, capturedAt: NOW.toISOString() }, status: "pending", createdAt: NOW, updatedAt: NOW, expiresAt: new Date(NOW.getTime() + 15 * 60_000), result: null, failureCode: null };
  }
  async function actionService() {
    const fixture = await setup("hyatt");
    const record = new RecordManualBalance(accounts, balances, undefined, clock);
    const execute = vi.spyOn(record, "execute");
    let currentTime = NOW;
    const service = new ManageAssistantActions(actions, { getLoyaltyAccount: new GetLoyaltyAccount(accounts, balances, clock), recordManualBalance: record, createTripGoal: new CreateTripGoal(new DrizzleTripGoalRepository(db), accounts, balances, clock) }, { now: () => currentTime });
    const proposal = await service.proposeManualBalance({ userId: fixture.userId, requestId: randomUUID(), accountId: fixture.account.id, points: 100, capturedAt: NOW.toISOString() });
    return { ...fixture, proposal, service, execute, advance: (milliseconds: number) => { currentTime = new Date(NOW.getTime() + milliseconds); } };
  }
  it("claims a persistent action exactly once under concurrent repository callers", async () => {
    const proposed = await actions.insert(actionRecord());
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => actions.claim(proposed.id, owner, NOW)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await actions.findOwned(proposed.id, owner)).toMatchObject({ status: "executing" });
    expect(await actions.claim(proposed.id, owner, NOW)).toBeNull();
    await actions.finish(proposed.id, owner, "succeeded", NOW, { points: 100 }, null);
    expect(await actions.claim(proposed.id, owner, NOW)).toBeNull();
    expect(await actions.findOwned(proposed.id, owner)).toMatchObject({ status: "succeeded", result: { points: 100 } });
  });
  it("keeps duplicate action payloads and lifecycle metadata immutable", async () => {
    const original = actionRecord();
    await actions.insert(original);
    if (original.kind !== "manual_balance") throw new Error("Unexpected fixture proposal kind");
    const modified: AssistantAction = { ...original, payload: { ...original.payload, points: 999999 }, status: "succeeded", expiresAt: new Date(NOW.getTime() + 86400_000), result: { points: 999999 } };
    const duplicates = await Promise.all([1,2,3].map(() => actions.insert(modified)));
    expect(duplicates.every((row) => row.status === "pending" && row.expiresAt.getTime() === original.expiresAt.getTime())).toBe(true);
    const persisted = await actions.findOwned(original.id, owner);
    expect(persisted).toMatchObject({ payload: { points: 100 }, status: "pending", result: null });
    await expect(actions.insert({ ...modified, userId: `${owner}-other` })).rejects.toThrow();
    expect(await actions.findOwned(original.id, owner)).toEqual(persisted);
  });
  it("hides another owner's persistent proposal from reads, claims, approvals and browser SQL", async () => {
    const fixture = await actionService();
    const otherOwner = `${owner}-other`;
    expect(await actions.findOwned(fixture.proposal.id, otherOwner)).toBeNull();
    expect(await actions.claim(fixture.proposal.id, otherOwner, NOW)).toBeNull();
    expect(await actions.listOwned(otherOwner, 50)).toHaveLength(0);
    await expect(fixture.service.approve(fixture.proposal.id, otherOwner)).rejects.toMatchObject({ code: "ASSISTANT_ACTION_NOT_FOUND" });
    await expect(fixture.service.reject(fixture.proposal.id, otherOwner)).rejects.toMatchObject({ code: "ASSISTANT_ACTION_NOT_FOUND" });
    await actions.settlePending(fixture.proposal.id, otherOwner, "rejected", NOW);
    expect(await actions.findOwned(fixture.proposal.id, fixture.userId)).toMatchObject({ status: "pending" });
    expect(fixture.execute).not.toHaveBeenCalled();
    await sql.unsafe(`GRANT SELECT ON assistant_action TO ${browserRole}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${browserRole}`);
      expect(await tx`SELECT id FROM assistant_action WHERE id = ${fixture.proposal.id}`).toHaveLength(0);
    });
  });
  it("recovers an expired execution lease to durable unknown and never replays it", async () => {
    const fixture = await actionService();
    expect(await actions.claim(fixture.proposal.id, fixture.userId, NOW)).not.toBeNull();
    fixture.advance(5 * 60_000);
    expect((await fixture.service.list(fixture.userId))[0]).toMatchObject({ status: "unknown", failureCode: "EXECUTION_OUTCOME_UNKNOWN" });
    expect(await fixture.service.approve(fixture.proposal.id, fixture.userId)).toMatchObject({ status: "unknown" });
    expect(await actions.claim(fixture.proposal.id, fixture.userId, new Date(NOW.getTime() + 5 * 60_000))).toBeNull();
    await actions.finish(fixture.proposal.id, fixture.userId, "succeeded", new Date(NOW.getTime() + 6 * 60_000), { points: 100 }, null);
    expect(await actions.findOwned(fixture.proposal.id, fixture.userId)).toMatchObject({ status: "unknown", result: null });
    const secondClient = postgres(url!, { max: 1 });
    try {
      const restarted = new DrizzleAssistantActionRepository(drizzle(secondClient, { schema }));
      expect(await restarted.findOwned(fixture.proposal.id, fixture.userId)).toMatchObject({ status: "unknown" });
      expect(await restarted.claim(fixture.proposal.id, fixture.userId, new Date(NOW.getTime() + 6 * 60_000))).toBeNull();
    } finally { await secondClient.end({ timeout: 5 }); }
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(0);
  });
  it("expires persistent proposals at the boundary without claiming or mutating balances", async () => {
    const fixture = await actionService();
    const deadline = new Date(fixture.proposal.expiresAt);
    expect(await actions.claim(fixture.proposal.id, fixture.userId, deadline)).toBeNull();
    // Reject and expiry race protection: reject cannot settle an expired row.
    await actions.settlePending(fixture.proposal.id, fixture.userId, "rejected", deadline);
    expect(await actions.findOwned(fixture.proposal.id, fixture.userId)).toMatchObject({ status: "pending" });
    fixture.advance(15 * 60_000);
    expect(await fixture.service.approve(fixture.proposal.id, fixture.userId)).toMatchObject({ status: "expired" });
    expect(await fixture.service.approve(fixture.proposal.id, fixture.userId)).toMatchObject({ status: "expired" });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(await balances.findByAccountId(fixture.account.id, 10)).toHaveLength(0);
  });
});
