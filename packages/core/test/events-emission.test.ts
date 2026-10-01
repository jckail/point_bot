import { describe, expect, it } from "vitest";

import {
  IssueAccessToken,
  RevokeAccessToken,
} from "../src/application/agent/access-tokens";
import { GrantConsent, RevokeConsent } from "../src/application/agent/consents";
import {
  ResolveObservationReview,
  SubmitObservation,
} from "../src/application/agent/submit-observation";
import {
  CheckAwardWatches,
} from "../src/application/loyalty/award-watches";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { IngestDealPage } from "../src/application/loyalty/ingest-deal-page";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { RestoreLoyaltyAccount } from "../src/application/loyalty/restore-loyalty-account";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import {
  UnlinkLoyaltyAccount,
  UpdateLoyaltyAccount,
} from "../src/application/loyalty/update-loyalty-account";
import {
  DeleteTripGoal,
  UpdateTripGoal,
} from "../src/application/loyalty/update-trip-goal";
import type { PageScraper } from "../src/application/ports";
import { createAwardWatch } from "../src/domain/loyalty/award-watch";
import { SimulatedTravelProviderGateway } from "../src/infrastructure/providers/simulated-travel-provider-gateway";
import {
  InMemoryActivityEventRepository,
  InMemoryAwardWatchRepository,
  InMemoryBalanceSnapshotRepository,
  InMemoryConsents,
  InMemoryLoyaltyAccountRepository,
  InMemoryObservations,
  InMemoryTokens,
  InMemoryTripGoalRepository,
  FakeCredentialVault,
  RecordingEventing,
} from "./fakes";

let now = new Date("2026-07-08T12:00:00.000Z");
const clock = { now: () => now };

function setup() {
  now = new Date("2026-07-08T12:00:00.000Z");
  const eventing = new RecordingEventing();
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const activity = new InMemoryActivityEventRepository();
  const consents = new InMemoryConsents();
  const observations = new InMemoryObservations();
  const link = new LinkLoyaltyAccount(accounts, activity, clock, eventing);
  const record = new RecordManualBalance(accounts, balances, activity, clock, eventing);
  return { eventing, accounts, balances, activity, consents, observations, link, record };
}

async function linked(s: ReturnType<typeof setup>) {
  const { accountId } = await s.link.execute({
    userId: "u1",
    providerId: "united",
    membershipNumber: "SECRET-123",
  });
  return accountId;
}

describe("event emission", () => {
  it("link / update / unlink / restore emit account events without secrets", async () => {
    const s = setup();
    const accountId = await linked(s);
    await new UpdateLoyaltyAccount(s.accounts, s.activity, clock, s.eventing).execute({
      userId: "u1",
      accountId,
      membershipNumber: "NEW-SECRET",
      pinned: true,
    });
    await new UnlinkLoyaltyAccount(s.accounts, s.activity, clock, s.eventing).execute(
      "u1",
      accountId,
    );
    await new RestoreLoyaltyAccount(
      s.accounts,
      s.balances,
      s.activity,
      clock,
      s.eventing,
    ).execute("u1", accountId);

    expect(s.eventing.types()).toEqual([
      "account.linked",
      "account.updated",
      "account.unlinked",
      "account.restored",
    ]);
    expect(s.eventing.events[1]).toMatchObject({
      aggregateId: accountId,
      payload: { providerId: "united", changed: ["membershipNumber", "pinned"] },
    });
    expect(JSON.stringify(s.eventing.events)).not.toContain("SECRET");
  });

  it("failed link (duplicate) emits nothing extra", async () => {
    const s = setup();
    await linked(s);
    await expect(linked(s)).rejects.toMatchObject({ code: "DUPLICATE_LOYALTY_ACCOUNT" });
    expect(s.eventing.types()).toEqual(["account.linked"]);
  });

  it("manual record carries previous points and source", async () => {
    const s = setup();
    const accountId = await linked(s);
    await s.record.execute({ userId: "u1", accountId, points: 100 });
    now = new Date(now.getTime() + 1000);
    await s.record.execute({ userId: "u1", accountId, points: 150, source: "agent" });
    const [, first, second] = s.eventing.events;
    expect(first).toMatchObject({
      type: "balance.recorded",
      aggregateId: accountId,
      payload: { points: 100, previousPoints: null, source: "manual" },
    });
    expect(second).toMatchObject({
      payload: { points: 150, previousPoints: 100, source: "agent" },
    });
  });

  it("a failed record emits nothing", async () => {
    const s = setup();
    const accountId = await linked(s);
    await expect(
      s.record.execute({
        userId: "u1",
        accountId,
        points: 5,
        capturedAt: new Date(now.getTime() + 86_400_000),
      }),
    ).rejects.toMatchObject({ code: "INVALID_CAPTURE_TIME" });
    expect(s.eventing.types()).toEqual(["account.linked"]);
  });

  it("sync emits balance.recorded with source sync", async () => {
    const s = setup();
    const accountId = await linked(s);
    const sync = new SyncLoyaltyAccount(
      s.accounts,
      s.balances,
      new SimulatedTravelProviderGateway(),
      new FakeCredentialVault(),
      s.activity,
      clock,
      s.eventing,
    );
    const result = await sync.execute({ userId: "u1", accountId });
    expect(s.eventing.events.at(-1)).toMatchObject({
      type: "balance.recorded",
      payload: { source: "sync", points: result.points, previousPoints: null },
    });
  });

  it("consent grant and revoke emit one event per grant", async () => {
    const s = setup();
    const grant = new GrantConsent(s.consents, clock, s.eventing);
    const consent = await grant.execute({ userId: "u1", providerId: "united" });
    await new RevokeConsent(s.consents, clock, s.eventing).execute("u1", consent.id);
    // Revoking twice is a no-op and emits nothing.
    await new RevokeConsent(s.consents, clock, s.eventing).execute("u1", consent.id);
    expect(s.eventing.types()).toEqual(["consent.granted", "consent.revoked"]);
    expect(s.eventing.events[0]).toMatchObject({
      aggregateId: consent.id,
      payload: { providerId: "united" },
    });
  });

  it("token issue/revoke emit events that never contain the secret", async () => {
    const eventing = new RecordingEventing();
    const tokens = new InMemoryTokens();
    const issued = await new IssueAccessToken(tokens, clock, eventing).execute({
      userId: "u1",
      name: "claude",
      scopes: ["portfolio:read"],
      ttlDays: 7,
    });
    await new RevokeAccessToken(tokens, clock, eventing).execute("u1", issued.token.id);
    expect(eventing.types()).toEqual(["token.issued", "token.revoked"]);
    expect(eventing.events[0]).toMatchObject({
      aggregateId: issued.token.id,
      payload: { scopes: ["portfolio:read"] },
    });
    const serialized = JSON.stringify(eventing.events);
    expect(serialized).not.toContain(issued.plaintext);
    expect(serialized).not.toContain("claude");
  });

  describe("observations", () => {
    const base = {
      userId: "u1",
      skillId: "united.capture-balance",
      sourceUrl: "https://www.united.com/en/us/myunited?token=secret",
      agent: "test-agent",
      canLinkAccount: true,
      membershipNumber: "SECRET-123",
    };

    function agentSetup() {
      const s = setup();
      const submit = new SubmitObservation(
        s.accounts,
        s.balances,
        s.consents,
        s.observations,
        s.record,
        s.link,
        clock,
        s.eventing,
      );
      const review = new ResolveObservationReview(
        s.accounts,
        s.balances,
        s.observations,
        s.record,
        clock,
        s.eventing,
      );
      return { ...s, submit, review };
    }

    it("recorded reading emits link + balance events; unchanged emits none", async () => {
      const s = agentSetup();
      await new GrantConsent(s.consents, clock, s.eventing).execute({
        userId: "u1",
        providerId: "united",
      });
      await s.submit.execute({ ...base, points: 1000 });
      await s.submit.execute({ ...base, points: 1000 });
      expect(s.eventing.types()).toEqual([
        "consent.granted",
        "account.linked",
        "balance.recorded",
      ]);
      expect(s.eventing.events[2]).toMatchObject({ payload: { source: "agent" } });
    });

    it("held reading emits observation.held; confirm records and emits", async () => {
      const s = agentSetup();
      await new GrantConsent(s.consents, clock, s.eventing).execute({
        userId: "u1",
        providerId: "united",
      });
      await s.submit.execute({ ...base, points: 1000 });
      const held = await s.submit.execute({ ...base, points: 900_000 });
      expect(held.outcome).toBe("needs_review");
      expect(s.eventing.types().at(-1)).toBe("observation.held");
      expect(s.eventing.events.at(-1)).toMatchObject({
        aggregateId: held.reviewId,
        payload: { points: 900_000, previousPoints: 1000, providerId: "united" },
      });

      // Confirming needs the latest balance to still equal previousPoints.
      await s.review.confirm("u1", held.reviewId!);
      expect(s.eventing.types().slice(-2)).toEqual([
        "balance.recorded",
        "observation.confirmed",
      ]);
      expect(JSON.stringify(s.eventing.events)).not.toContain("SECRET");
      expect(JSON.stringify(s.eventing.events)).not.toContain("token=secret");
    });

    it("reject emits observation.rejected and a second resolve emits nothing", async () => {
      const s = agentSetup();
      await new GrantConsent(s.consents, clock, s.eventing).execute({
        userId: "u1",
        providerId: "united",
      });
      await s.submit.execute({ ...base, points: 1000 });
      const held = await s.submit.execute({ ...base, points: 900_000 });
      await s.review.reject("u1", held.reviewId!);
      const count = s.eventing.events.length;
      expect(s.eventing.types().at(-1)).toBe("observation.rejected");
      await expect(s.review.reject("u1", held.reviewId!)).rejects.toMatchObject({
        code: "REVIEW_ALREADY_RESOLVED",
      });
      expect(s.eventing.events).toHaveLength(count);
    });
  });

  it("goals emit created / updated / deleted", async () => {
    const eventing = new RecordingEventing();
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const goals = new InMemoryTripGoalRepository();
    const created = await new CreateTripGoal(goals, accounts, balances, clock, eventing).execute({
      userId: "u1",
      title: "Private title",
      targetPoints: 50_000,
    });
    await new UpdateTripGoal(goals, accounts, balances, clock, eventing).execute({
      userId: "u1",
      goalId: created.id,
      targetPoints: 60_000,
      notes: "private",
    });
    await new DeleteTripGoal(goals, clock, eventing).execute("u1", created.id);
    expect(eventing.types()).toEqual(["goal.created", "goal.updated", "goal.deleted"]);
    expect(eventing.events[1]).toMatchObject({
      aggregateId: created.id,
      payload: { changed: ["targetPoints", "notes"] },
    });
    expect(JSON.stringify(eventing.events)).not.toContain("Private");
  });

  it("award watch hit emits watch.triggered", async () => {
    const eventing = new RecordingEventing();
    const watches = new InMemoryAwardWatchRepository();
    const watch = createAwardWatch({
      userId: "u1",
      url: "https://blog.example/hyatt",
      label: "Hyatt",
      minCentsPerPoint: 2,
      now,
    });
    await watches.insert(watch);
    const scraper: PageScraper = {
      scrape: async () => ({
        url: watch.url,
        title: "t",
        markdown: "Park Hyatt: 10,000 points instead of $300.00 at Hyatt",
        fetchedAt: now,
      }),
    };
    const result = await new CheckAwardWatches(
      watches,
      new IngestDealPage(scraper),
      clock,
      eventing,
    ).execute();
    expect(result.hits).toHaveLength(1);
    expect(eventing.events).toHaveLength(1);
    expect(eventing.events[0]).toMatchObject({
      type: "watch.triggered",
      aggregateId: watch.id,
      payload: { minCentsPerPoint: 2 },
    });
  });
});
