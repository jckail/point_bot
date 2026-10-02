import { describe, expect, it, vi } from "vitest";
import { IssueAccessToken, RevokeAccessToken } from "../src/application/agent/access-tokens";
import { GrantConsent, RevokeConsent } from "../src/application/agent/consents";
import { ResolveObservationReview, SubmitObservation } from "../src/application/agent/submit-observation";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { AtomicObservationEventing, InMemoryActivityEventRepository, InMemoryBalanceSnapshotRepository, InMemoryConsents, InMemoryLoyaltyAccountRepository, InMemoryObservations, InMemoryTokens } from "./fakes";
import { asUserId } from "./ids";

const owner = asUserId("owner-one");
const captureId = "8d902f84-6b33-49ee-8117-d05a3898b2e4";
const base = { userId: owner, skillId: "united.capture-balance", sourceUrl: "https://www.united.com/account?private=claim", agent: "capture-label", credential: { kind: "session" as const }, sourceMethod: "page_capture" as const };

async function setup(linked = true) {
  let instant = new Date("2026-10-02T00:00:00.000Z");
  const clock = { now: () => instant };
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const activity = new InMemoryActivityEventRepository();
  const consents = new InMemoryConsents();
  const tokens = new InMemoryTokens();
  const observations = new InMemoryObservations({ accounts, consents, tokens });
  const eventing = new AtomicObservationEventing({ accounts, balances, activity, observations, consents, tokens });
  const record = new RecordManualBalance(accounts, balances, activity, clock, eventing);
  const link = new LinkLoyaltyAccount(accounts, activity, clock, eventing);
  const submit = new SubmitObservation(accounts, balances, consents, observations, record, link, clock, eventing);
  const review = new ResolveObservationReview(accounts, balances, observations, record, clock, eventing);
  const grant = new GrantConsent(consents, clock, eventing);
  if (linked) await link.execute({ userId: owner, providerId: "united", membershipNumber: "M1" });
  await grant.execute({ userId: owner, providerId: "united" });
  return { accounts, balances, activity, consents, tokens, observations, eventing, record, link, submit, review, grant, clock,
    advance: (ms: number) => { instant = new Date(instant.getTime() + ms); },
    setNow: (date: Date) => { instant = date; },
  };
}

async function held(s: Awaited<ReturnType<typeof setup>>) {
  await s.submit.execute({ ...base, points: 50_000 });
  const result = await s.submit.execute({ ...base, points: 5, captureId });
  const row = s.observations.rows.find(observation => observation.id === result.reviewId);
  if (!row) throw new Error("Expected held fixture");
  return row;
}

const counts = (s: Awaited<ReturnType<typeof setup>>) => ({ snapshots: s.balances.rows.length, activity: s.activity.rows.length, receipts: s.observations.rows.length, events: s.eventing.events.length });

describe("protected observation application", () => {
  it("returns the original receipt across omitted-time retries without duplicating effects", async () => {
    const s = await setup();
    const first = await s.submit.execute({ ...base, points: 50_000, captureId });
    const before = counts(s);
    const receipt = structuredClone(s.observations.rows[0]);
    s.advance(60_000);
    expect(await s.submit.execute({ ...base, points: 50_000, captureId: captureId.toUpperCase() })).toEqual(first);
    expect(counts(s)).toEqual(before);
    expect(s.observations.rows[0]).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toContain("private=claim");
  });

  it("conflicts on changed points or membership claims under one capture ID", async () => {
    const s = await setup();
    await s.submit.execute({ ...base, points: 50_000, captureId, membershipNumber: "M1" });
    const before = counts(s);
    for (const changes of [{ points: 50_001, membershipNumber: "M1" }, { points: 50_000, membershipNumber: "M2" }, { points: 50_000 }]) {
      await expect(s.submit.execute({ ...base, captureId, ...changes })).rejects.toMatchObject({ code: "OBSERVATION_REPLAY_CONFLICT" });
    }
    expect(counts(s)).toEqual(before);
  });

  it.each(["confirm", "reject"] as const)("replays a held capture's authoritative receipt after %s without reviving review", async decision => {
    const s = await setup();
    const row = await held(s);
    const before = counts(s);
    const pending = await s.submit.execute({ ...base, points: 5, captureId });
    expect(pending.reviewId).toBe(row.id);
    expect(counts(s)).toEqual(before);
    await s.review[decision](owner, row.id);
    const resolved = counts(s);
    const repeated = await s.submit.execute({ ...base, points: 5, captureId });
    expect(repeated).toMatchObject({ outcome: decision === "confirm" ? "recorded" : "rejected", observationId: row.id, reviewId: null });
    expect(counts(s)).toEqual(resolved);
    await expect(s.review.confirm(owner, row.id)).rejects.toMatchObject({ code: "REVIEW_ALREADY_RESOLVED" });
  });

  it("reauthorizes credential rotation and current grants while retaining original witnesses", async () => {
    const s = await setup();
    const mint = new IssueAccessToken(s.tokens, s.clock);
    const first = await mint.execute({ userId: owner, name: "first", scopes: ["observations:write"], ttlDays: 1 });
    const original = await s.submit.execute({ ...base, points: 50_000, captureId, credential: { kind: "personal_access_token", tokenId: first.token.id } });
    const witnesses = structuredClone(s.observations.rows[0]);
    await new RevokeAccessToken(s.tokens, s.clock).execute(owner, first.token.id);
    await expect(s.submit.execute({ ...base, points: 50_000, captureId, credential: { kind: "personal_access_token", tokenId: first.token.id } })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const second = await mint.execute({ userId: owner, name: "second", scopes: ["observations:write"], ttlDays: 1 });
    const input = { ...base, points: 50_000, captureId, credential: { kind: "personal_access_token" as const, tokenId: second.token.id } };
    expect(await s.submit.execute(input)).toEqual(original);
    const selected = [...s.consents.rows.values()].find(consent => !consent.revokedAt);
    if (!selected) throw new Error("Expected grant");
    await new RevokeConsent(s.consents, s.clock, s.eventing).execute(owner, selected.id);
    await expect(s.submit.execute(input)).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await s.grant.execute({ userId: owner, providerId: "united" });
    expect(await s.submit.execute(input)).toEqual(original);
    expect(s.observations.rows[0]).toEqual(witnesses);
  });

  it("rechecks current PAT portfolio authority before auto-linking", async () => {
    const s = await setup(false);
    const token = await new IssueAccessToken(s.tokens, s.clock).execute({ userId: owner, name: "capture-only", scopes: ["observations:write"] });
    await expect(s.submit.execute({ ...base, points: 1000, membershipNumber: "M1", canLinkAccount: true, credential: { kind: "personal_access_token", tokenId: token.token.id } })).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    expect(s.accounts.rows.size).toBe(0);
  });

  it("rolls back a snapshot and all associated effects when a locked token expires during writing", async () => {
    const s = await setup();
    const token = await new IssueAccessToken(s.tokens, s.clock).execute({ userId: owner, name: "short-lived", scopes: ["observations:write"], ttlDays: 1 });
    const before = counts(s);
    const account = structuredClone([...s.accounts.rows.values()][0]);
    const insert = s.balances.insert.bind(s.balances);
    vi.spyOn(s.balances, "insert").mockImplementationOnce(async snapshot => { await insert(snapshot); s.advance(86_400_000); });
    await expect(s.submit.execute({ ...base, points: 1000, captureId, credential: { kind: "personal_access_token", tokenId: token.token.id } })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(counts(s)).toEqual(before);
    expect([...s.accounts.rows.values()][0]).toEqual(account);
  });

  it("rolls back auto-link, held receipt and events when selected consent expires after a wait", async () => {
    const s = await setup(false);
    const before = counts(s);
    const publish = s.eventing.publisher.publish.bind(s.eventing.publisher);
    vi.spyOn(s.eventing.publisher, "publish").mockImplementation(async events => {
      await publish(events);
      if (events.some(event => event.type === "observation.held")) s.advance(30 * 86_400_000);
    });
    await expect(s.submit.execute({ ...base, points: 9_000_000, captureId, membershipNumber: "M1", canLinkAccount: true })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(s.accounts.rows.size).toBe(0);
    expect(counts(s)).toEqual(before);
  });

  it("rejects expiry reached while waiting for the review lock", async () => {
    const s = await setup();
    const row = await held(s);
    const before = counts(s);
    const lock = s.observations.lockReview.bind(s.observations);
    vi.spyOn(s.observations, "lockReview").mockImplementationOnce(async (...args) => { const receipt = await lock(...args); s.setNow(row.reviewExpiresAt!); return receipt; });
    await expect(s.review.confirm(owner, row.id)).rejects.toMatchObject({ code: "REVIEW_EXPIRED" });
    expect(counts(s)).toEqual(before);
  });

  it("rolls back confirmation when expiry is crossed after the snapshot insert", async () => {
    const s = await setup();
    const row = await held(s);
    const before = counts(s);
    const insert = s.balances.insert.bind(s.balances);
    vi.spyOn(s.balances, "insert").mockImplementationOnce(async snapshot => { await insert(snapshot); s.setNow(row.reviewExpiresAt!); });
    await expect(s.review.confirm(owner, row.id)).rejects.toMatchObject({ code: "REVIEW_EXPIRED" });
    expect(counts(s)).toEqual(before);
    expect(s.observations.rows.find(receipt => receipt.id === row.id)?.outcome).toBe("needs_review");
  });

  it("rolls back confirmation state and effects after an outbox failure without compensation", async () => {
    const s = await setup();
    const row = await held(s);
    const before = counts(s);
    const publish = s.eventing.publisher.publish.bind(s.eventing.publisher);
    vi.spyOn(s.eventing.publisher, "publish").mockImplementation(async events => {
      await publish(events);
      if (events.some(event => event.type === "observation.confirmed")) throw new Error("Outbox fixture failure");
    });
    await expect(s.review.confirm(owner, row.id)).rejects.toThrow("Outbox fixture failure");
    expect(counts(s)).toEqual(before);
    expect(s.observations.rows.find(receipt => receipt.id === row.id)?.outcome).toBe("needs_review");
  });

  it("refuses a new baseline snapshot even when its points are unchanged", async () => {
    const s = await setup();
    const row = await held(s);
    s.advance(1000);
    await s.record.execute({ userId: owner, accountId: row.accountId, points: row.previousPoints! });
    await expect(s.review.confirm(owner, row.id)).rejects.toMatchObject({ code: "REVIEW_STALE" });
  });

  it.each([false, true])("preserves SQL-shaped legacy NULL provenance fallback; changed baseline=%s", async changed => {
    const s = await setup();
    const row = await held(s);
    const index = s.observations.rows.indexOf(row);
    s.observations.rows[index] = { ...row, provenanceVersion: 0, payloadHash: null, baselineSnapshotId: null };
    if (changed) {
      s.advance(1000);
      await s.record.execute({ userId: owner, accountId: row.accountId, points: 51_000 });
      await expect(s.review.confirm(owner, row.id)).rejects.toMatchObject({ code: "REVIEW_STALE" });
    } else {
      expect((await s.review.confirm(owner, row.id)).outcome).toBe("recorded");
    }
  });

  it("stores the actual backdated snapshot ID instead of inferring the latest snapshot", async () => {
    const s = await setup();
    await s.submit.execute({ ...base, points: 50_000 });
    const result = await s.submit.execute({ ...base, points: 5, observedAt: new Date(s.clock.now().getTime() - 86_400_000) });
    if (!result.reviewId) throw new Error("Expected held fixture");
    await s.review.confirm(owner, result.reviewId);
    const receipt = s.observations.rows.find(row => row.id === result.reviewId);
    const lastInserted = s.balances.rows.at(-1);
    expect(receipt?.recordedSnapshotId).toBe(lastInserted?.id);
    expect(lastInserted?.points).toBe(5);
    expect((await s.balances.findLatestByAccountIds([result.accountId])).get(result.accountId)?.id).not.toBe(lastInserted?.id);
  });

  it.each([50_000, 5, 51_000])("refuses a future capture before outcome selection, points=%s", async points => {
    const s = await setup();
    await s.submit.execute({ ...base, points: 50_000 });
    const before = counts(s);
    await expect(s.submit.execute({ ...base, points, observedAt: new Date(s.clock.now().getTime() + 1) })).rejects.toMatchObject({ code: "INVALID_OBSERVATION" });
    expect(counts(s)).toEqual(before);
  });

  it("preserves unknown legacy credential provenance and refuses unsupported non-atomic hosts", async () => {
    const s = await setup();
    const { credential: _credential, ...legacy } = base;
    await s.submit.execute({ ...legacy, points: 1000 });
    expect(s.observations.rows[0]).toMatchObject({ provenanceVersion: 0, credentialKind: null, accessTokenId: null });
    const unsupported = new SubmitObservation(s.accounts, s.balances, s.consents, s.observations, s.record, s.link, s.clock);
    await expect(unsupported.execute({ ...base, points: 1000 })).rejects.toThrow("atomic unit of work");
  });
});
