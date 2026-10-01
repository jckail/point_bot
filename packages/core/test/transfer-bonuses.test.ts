import { describe, expect, it } from "vitest";

import {
  ListActiveTransferBonuses,
  RecordTransferBonus,
} from "../src/application/loyalty/transfer-bonuses";
import {
  ListBestRedemptions,
  PlanRedemption,
} from "../src/application/loyalty/plan-redemption";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import type { AwardAvailabilitySource } from "../src/application/ports";
import type { AwardSearchResult } from "../src/domain/loyalty/award-availability";
import { StubAwardAvailabilitySource } from "../src/infrastructure/award-search/award-availability-sources";
import { EVENT_SCHEMA_VERSIONS, EVENT_TYPES } from "../src/domain/events";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryCustomValuationRepository,
  InMemoryLoyaltyAccountRepository,
  InMemoryTransferBonusRepository,
  RecordingEventing,
} from "./fakes";

import { asUserId } from "./ids";
const now = new Date("2026-10-15T12:00:00Z");
const clock = { now: () => now };
const window = {
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: new Date("2026-10-31T00:00:00Z"),
};
const valid = {
  fromProviderId: "chase-ultimate-rewards",
  toProviderId: "hyatt",
  multiplierPermille: 1300,
  ...window,
  source: "user" as const,
  createdBy: asUserId("u1"),
};

describe("RecordTransferBonus", () => {
  it("starts empty: nothing is invented", async () => {
    const repo = new InMemoryTransferBonusRepository();
    expect(await new ListActiveTransferBonuses(repo, clock).execute()).toEqual([]);
  });

  it("records a bonus, lists it while active and emits transfer_bonus.recorded", async () => {
    const repo = new InMemoryTransferBonusRepository();
    const eventing = new RecordingEventing();
    const bonus = await new RecordTransferBonus(repo, clock, eventing).execute(valid);
    expect(bonus).toMatchObject({ multiplierPermille: 1300, verifiedAt: null, source: "user" });
    expect(await new ListActiveTransferBonuses(repo, clock).execute(asUserId("u1"))).toHaveLength(1);
    expect(
      await new ListActiveTransferBonuses(repo, { now: () => new Date("2026-11-02T00:00:00Z") }).execute(asUserId("u1")),
    ).toHaveLength(0);
    expect(eventing.events).toHaveLength(1);
    expect(eventing.events[0]).toMatchObject({
      type: "transfer_bonus.recorded",
      aggregateId: bonus.id,
      userId: "u1",
      version: EVENT_SCHEMA_VERSIONS["transfer_bonus.recorded"],
      payload: {
        fromProviderId: "chase-ultimate-rewards",
        toProviderId: "hyatt",
        multiplierPermille: 1300,
        source: "user",
      },
    });
    expect(JSON.stringify(eventing.events[0])).not.toContain("http");
    expect(EVENT_TYPES).toContain("transfer_bonus.recorded");
  });

  it.each([
    ["unknown source program", { fromProviderId: "nope" }, /Unknown source/],
    ["unknown destination", { toProviderId: "nope" }, /Unknown destination/],
    ["edge missing from the graph", { fromProviderId: "hyatt", toProviderId: "united" }, /no transfer path/],
    ["multiplier of exactly 1.0", { multiplierPermille: 1000 }, /greater than 1\.0/],
    ["multiplier below 1.0", { multiplierPermille: 900 }, /greater than 1\.0/],
    ["multiplier above 3.0", { multiplierPermille: 3001 }, /at most 3\.0/],
    ["non-integer permille", { multiplierPermille: 1300.5 }, /integer permille/],
    ["ends before it starts", { endsAt: new Date("2026-09-01T00:00:00Z") }, /endsAt must be after/],
    ["ends when it starts", { endsAt: window.startsAt }, /endsAt must be after/],
    ["invalid date", { startsAt: new Date("nope") }, /valid date/],
    ["non-http source url", { sourceUrl: "ftp://x" }, /http\(s\)/],
    ["unknown source", { source: "rumor" as never }, /Unknown bonus source/],
  ])("rejects %s with INVALID_TRANSFER_BONUS and emits nothing", async (_name, patch, message) => {
    const repo = new InMemoryTransferBonusRepository();
    const eventing = new RecordingEventing();
    await expect(
      new RecordTransferBonus(repo, clock, eventing).execute({ ...valid, ...patch }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSFER_BONUS", message: expect.stringMatching(message) });
    expect(repo.rows.size).toBe(0);
    expect(eventing.events).toHaveLength(0);
  });

  it("accepts the boundary multipliers 1.001 and 3.0", async () => {
    const repo = new InMemoryTransferBonusRepository();
    const uc = new RecordTransferBonus(repo, clock);
    await uc.execute({ ...valid, multiplierPermille: 1001 });
    await uc.execute({ ...valid, multiplierPermille: 3000 });
    expect(repo.rows.size).toBe(2);
  });
});

async function seedUser(points: Record<string, number>, daysAgo = 0) {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const valuations = new InMemoryCustomValuationRepository();
  for (const [providerId, p] of Object.entries(points)) {
    const account = createLoyaltyAccount({ userId: asUserId("u1"), providerId, membershipNumber: "M1" });
    await accounts.insert(account);
    await balances.insert(
      createBalanceSnapshot({
        loyaltyAccountId: account.id,
        points: p,
        source: "manual",
        capturedAt: new Date(now.getTime() - daysAgo * 86_400_000),
      }),
    );
  }
  return { list: new ListLoyaltyAccounts(accounts, balances, clock, valuations), valuations };
}

describe("user-reported bonuses cannot skew other users (poisoning guard)", () => {
  it("shows an unverified user bonus only to the user who reported it", async () => {
    const repo = new InMemoryTransferBonusRepository();
    await new RecordTransferBonus(repo, clock).execute(valid); // reported by u1
    const list = new ListActiveTransferBonuses(repo, clock);
    expect(await list.execute(asUserId("u1"))).toHaveLength(1);
    expect(await list.execute(asUserId("u2"))).toHaveLength(0);
    expect(await list.execute()).toHaveLength(0); // trusted-only view
  });

  it("shows trusted bonuses to everyone: system/scraped sources and verified user reports", async () => {
    const repo = new InMemoryTransferBonusRepository();
    const record = new RecordTransferBonus(repo, clock);
    await record.execute({ ...valid, source: "manual", createdBy: null });
    await record.execute({ ...valid, toProviderId: "marriott", source: "user", verifiedAt: new Date("2026-10-02T00:00:00Z") });
    const list = new ListActiveTransferBonuses(repo, clock);
    expect(await list.execute(asUserId("someone-else"))).toHaveLength(2);
    expect(await list.execute()).toHaveLength(2);
  });

  it("a fake bonus from one user does not change another user's plan", async () => {
    const { list } = await seedUser({ "chase-ultimate-rewards": 100_000 });
    const bonuses = new InMemoryTransferBonusRepository();
    await new RecordTransferBonus(bonuses, clock).execute({ ...valid, createdBy: asUserId("attacker") });
    const plan = new PlanRedemption(list, new ListActiveTransferBonuses(bonuses, clock), new StubAwardAvailabilitySource(), clock);
    const result = await plan.execute({ userId: asUserId("u1"), goal: { kind: "hotel", targetProgramId: "hyatt", quantity: 3 } });
    expect(result.activeBonusCount).toBe(0);
    expect(result.plans[0]!.sources[0]!.bonus ?? null).toBeNull();
  });
});

describe("PlanRedemption / ListBestRedemptions", () => {
  it("plans from account read models and honors custom valuations", async () => {
    const { list, valuations } = await seedUser({ "chase-ultimate-rewards": 100_000 });
    const bonuses = new InMemoryTransferBonusRepository();
    const plan = new PlanRedemption(
      list,
      new ListActiveTransferBonuses(bonuses, clock),
      new StubAwardAvailabilitySource(() => now),
      clock,
    );
    const base = await plan.execute({ userId: asUserId("u1"), goal: { kind: "hotel", targetProgramId: "hyatt", quantity: 2 } });
    expect(base.plans[0]!.programId).toBe("hyatt");
    expect(base.availability).toBeNull();
    expect(base.activeBonusCount).toBe(0);

    await valuations.upsert({ userId: "u1", providerId: "chase-ultimate-rewards", centsPerPoint: 5, updatedAt: now } as never);
    const valued = await plan.execute({ userId: asUserId("u1"), goal: { kind: "hotel", targetProgramId: "hyatt", quantity: 2 } });
    const pick = (r: typeof base) => r.plans.find((p) => p.spotId === "hyatt-cat1-4-standard")!;
    expect(pick(base).opportunityCostCents).toBe(Math.round(16_000 * 1.6));
    expect(pick(valued).opportunityCostCents).toBe(16_000 * 5);
    expect(pick(valued).netGainCents).toBeLessThan(pick(base).netGainCents);
  });

  it("uses recorded bonuses and rejects bad goals with INVALID_REDEMPTION_GOAL", async () => {
    const { list } = await seedUser({ "chase-ultimate-rewards": 100_000 });
    const bonuses = new InMemoryTransferBonusRepository();
    await new RecordTransferBonus(bonuses, clock).execute(valid);
    const plan = new PlanRedemption(list, new ListActiveTransferBonuses(bonuses, clock), new StubAwardAvailabilitySource(), clock);
    const result = await plan.execute({ userId: asUserId("u1"), goal: { kind: "hotel", targetProgramId: "hyatt", quantity: 3 } });
    expect(result.activeBonusCount).toBe(1);
    expect(result.plans[0]!.sources[0]!.bonus?.multiplierPermille).toBe(1300);
    await expect(plan.execute({ userId: asUserId("u1"), goal: { targetProgramId: "zzz" } })).rejects.toMatchObject({
      code: "INVALID_REDEMPTION_GOAL",
    });
  });

  it("annotates availability only when the source returned data for that program", async () => {
    const { list } = await seedUser({ "chase-ultimate-rewards": 200_000, "amex-membership-rewards": 100_000 });
    const bonuses = new ListActiveTransferBonuses(new InMemoryTransferBonusRepository(), clock);
    const query = { origin: "JFK", destination: "NRT", dateFrom: "2026-12-01", dateTo: "2026-12-10", cabin: "business" as const };

    const ok: AwardAvailabilitySource = {
      searchAwards: async (): Promise<AwardSearchResult> => ({
        status: "ok",
        checkedAt: now,
        message: null,
        options: [
          { programId: "air-canada-aeroplan", carrier: "NH", date: "2026-12-03", cabin: "business", pointsCost: 75_000, taxesCents: 5_600, seats: 2 },
        ],
      }),
    };
    const withData = await new PlanRedemption(list, bonuses, ok, clock).execute({
      userId: asUserId("u1"),
      goal: { kind: "flight" },
      award: query,
      maxPlans: 50,
    });
    expect(withData.availability).toMatchObject({ status: "ok", message: null });
    const aeroplan = withData.plans.filter((p) => p.programId === "air-canada-aeroplan");
    expect(aeroplan.length).toBeGreaterThan(0);
    for (const p of aeroplan) {
      expect(p.availability!.options[0]).toMatchObject({ pointsCost: 75_000 });
      expect(p.caveats.join(" ")).not.toContain("Award availability is NOT verified");
      expect(p.caveats.join(" ")).toContain("re-check");
    }
    for (const p of withData.plans.filter((x) => x.programId !== "air-canada-aeroplan")) {
      expect(p.availability).toBeNull();
      expect(p.caveats.join(" ")).toContain("NOT verified");
    }

    const stub = await new PlanRedemption(list, bonuses, new StubAwardAvailabilitySource(() => now), clock).execute({
      userId: asUserId("u1"),
      goal: { kind: "flight" },
      award: query,
    });
    expect(stub.availability).toMatchObject({ status: "not_configured" });
    expect(stub.availability!.message).toMatch(/not configured/i);
    expect(stub.plans.every((p) => p.availability === null)).toBe(true);

    const failing: AwardAvailabilitySource = {
      searchAwards: async () => ({ status: "error", options: [], checkedAt: now, message: "boom" }),
    };
    const err = await new PlanRedemption(list, bonuses, failing, clock).execute({ userId: asUserId("u1"), goal: { kind: "flight" }, award: query });
    expect(err.availability!.status).toBe("error");
    expect(err.plans.every((p) => p.availability === null)).toBe(true);

    // Hotel goals never trigger an award search.
    let calls = 0;
    const counting: AwardAvailabilitySource = { searchAwards: async (q) => { calls++; return ok.searchAwards(q); } };
    await new PlanRedemption(list, bonuses, counting, clock).execute({ userId: asUserId("u1"), goal: { kind: "hotel" }, award: query });
    expect(calls).toBe(0);
  });

  it("ListBestRedemptions diversifies programs and respects the limit", async () => {
    const { list } = await seedUser({ "chase-ultimate-rewards": 400_000, "amex-membership-rewards": 300_000 });
    const plan = new PlanRedemption(
      list,
      new ListActiveTransferBonuses(new InMemoryTransferBonusRepository(), clock),
      new StubAwardAvailabilitySource(),
      clock,
    );
    const best = await new ListBestRedemptions(plan).execute({ userId: asUserId("u1"), limit: 4 });
    expect(best.plans.length).toBeLessThanOrEqual(4);
    expect(best.plans.length).toBeGreaterThan(0);
    const counts = new Map<string, number>();
    for (const p of best.plans) counts.set(p.programId, (counts.get(p.programId) ?? 0) + 1);
    expect([...counts.values()].every((c) => c <= 2)).toBe(true);
  });
});
