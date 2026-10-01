import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "../src/contracts/openapi";
import {
  bonusPercentToPermille,
  planRedemptionQuerySchema,
  planRedemptionResultDtoSchema,
  recordTransferBonusRequestSchema,
  sweetSpotDtoSchema,
  toPlanRedemptionResultDto,
  toSweetSpotDto,
  toTransferBonusDto,
  transferBonusDtoSchema,
  HTTP_STATUS_BY_ERROR_CODE,
} from "../src/contracts";
import { SWEET_SPOTS } from "../src/domain/loyalty/catalog/sweet-spots";
import { createTransferBonus } from "../src/domain/loyalty/transfer-bonus";
import {
  ListActiveTransferBonuses,
  RecordTransferBonus,
} from "../src/application/loyalty/transfer-bonuses";
import { PlanRedemption } from "../src/application/loyalty/plan-redemption";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { StubAwardAvailabilitySource } from "../src/infrastructure/award-search/award-availability-sources";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
  InMemoryTransferBonusRepository,
} from "./fakes";

import { asUserId } from "./ids";
const now = new Date("2026-10-15T00:00:00Z");

describe("optimizer wire contracts", () => {
  it("maps bonus percent to integer permille without float drift", () => {
    expect(bonusPercentToPermille(30)).toBe(1300);
    expect(bonusPercentToPermille(12.5)).toBe(1125);
    expect(bonusPercentToPermille(0.1)).toBe(1001);
    expect(bonusPercentToPermille(200)).toBe(3000);
  });

  it("validates bonus requests strictly", () => {
    const ok = {
      fromProviderId: "chase-ultimate-rewards",
      toProviderId: "hyatt",
      bonusPercent: 30,
      startsAt: "2026-10-01T00:00:00Z",
      endsAt: "2026-10-31T00:00:00Z",
    };
    expect(recordTransferBonusRequestSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, bonusPercent: 0 },
      { ...ok, bonusPercent: 201 },
      { ...ok, startsAt: "yesterday" },
      { ...ok, source: "manual" }, // clients cannot claim a trusted source
      { ...ok, sourceUrl: "not a url" },
    ]) {
      expect(recordTransferBonusRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("serializes bonuses and sweet spots to schema-valid DTOs", () => {
    const bonus = createTransferBonus({
      fromProviderId: "chase-ultimate-rewards",
      toProviderId: "hyatt",
      multiplierPermille: 1300,
      startsAt: new Date("2026-10-01T00:00:00Z"),
      endsAt: new Date("2026-10-31T00:00:00Z"),
      source: "user",
      now,
    });
    const dto = toTransferBonusDto(bonus);
    expect(transferBonusDtoSchema.parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({ bonusPercent: 30, verifiedAt: null });
    for (const spot of SWEET_SPOTS) {
      expect(sweetSpotDtoSchema.parse(toSweetSpotDto(spot)).verified).toBe(false);
    }
  });

  it("a real plan result round-trips through the response schema", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    for (const [providerId, points] of [
      ["chase-ultimate-rewards", 120_000],
      ["amex-membership-rewards", 4_000],
    ] as const) {
      const a = createLoyaltyAccount({ userId: asUserId("u1"), providerId, membershipNumber: "x" });
      await accounts.insert(a);
      await balances.insert(
        createBalanceSnapshot({ loyaltyAccountId: a.id, points, source: "manual", capturedAt: now }),
      );
    }
    const bonuses = new InMemoryTransferBonusRepository();
    const clock = { now: () => now };
    await new RecordTransferBonus(bonuses, clock).execute({
      fromProviderId: "chase-ultimate-rewards",
      toProviderId: "hyatt",
      multiplierPermille: 1300,
      startsAt: new Date("2026-10-01T00:00:00Z"),
      endsAt: new Date("2026-10-31T00:00:00Z"),
      source: "user",
      createdBy: asUserId("u1"),
    });
    const result = await new PlanRedemption(
      new ListLoyaltyAccounts(accounts, balances, clock),
      new ListActiveTransferBonuses(bonuses, clock),
      new StubAwardAvailabilitySource(() => now),
      clock,
    ).execute({
      userId: asUserId("u1"),
      goal: { kind: "any" },
      award: { origin: "SFO", destination: "NRT", dateFrom: "2026-12-01", dateTo: "2026-12-05", cabin: "business" },
      maxPlans: 50,
    });
    const dto = toPlanRedemptionResultDto(result);
    const parsed = planRedemptionResultDtoSchema.parse(dto);
    expect(parsed.plans.length).toBeGreaterThan(5);
    expect(parsed.availability?.status).toBe("not_configured");
    expect(parsed.plans.some((p) => p.status === "shortfall")).toBe(true);
    expect(parsed.plans.every((p) => p.availability === null)).toBe(true);
    expect(parsed.plans.some((p) => p.sources.some((s) => s.bonus?.verified === false))).toBe(true);
  });

  it("parses the query string: coerces numbers and requires the award fields together", () => {
    const q = planRedemptionQuerySchema.parse({ goalKind: "hotel", quantity: "3", minValueCpp: "1.5" });
    expect(q).toMatchObject({ goalKind: "hotel", quantity: 3, minValueCpp: 1.5 });
    expect(planRedemptionQuerySchema.safeParse({ origin: "JFK" }).success).toBe(false);
    expect(
      planRedemptionQuerySchema.safeParse({
        origin: "JFK", destination: "NRT", dateFrom: "2026-12-01", dateTo: "2026-12-05", cabin: "first",
      }).success,
    ).toBe(true);
    expect(planRedemptionQuerySchema.safeParse({ goalKind: "boat" }).success).toBe(false);
    expect(planRedemptionQuerySchema.safeParse({ quantity: "0" }).success).toBe(false);
    expect(planRedemptionQuerySchema.safeParse({ nope: "1" }).success).toBe(false);
  });

  it("documents the new endpoints and error codes", () => {
    const doc = buildOpenApiDocument() as unknown as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.paths["/api/v1/optimizer/plan"]!.get).toBeDefined();
    expect(doc.paths["/api/v1/deals/sweet-spots"]!.get).toBeDefined();
    expect(doc.paths["/api/v1/transfer-bonuses"]!.get).toBeDefined();
    expect(doc.paths["/api/v1/transfer-bonuses"]!.post).toBeDefined();
    for (const name of ["PlanRedemptionResultDto", "SweetSpotDto", "TransferBonusDto", "RecordTransferBonusRequest"]) {
      expect(doc.components.schemas[name], name).toBeDefined();
    }
    expect(HTTP_STATUS_BY_ERROR_CODE.INVALID_TRANSFER_BONUS).toBe(422);
    expect(HTTP_STATUS_BY_ERROR_CODE.INVALID_REDEMPTION_GOAL).toBe(422);
  });
});
