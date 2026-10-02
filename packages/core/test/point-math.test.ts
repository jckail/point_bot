import { describe, expect, it } from "vitest";
import { InvalidBalanceError, InvalidValuationError } from "../src/domain/errors";
import { checkedPointRatio, checkedPointSum, estimateValueCents } from "../src/domain/shared/point-math";
import { applyBonusPermille } from "../src/domain/loyalty/bonus-math";
import { convertPoints, type TransferEdge } from "../src/domain/loyalty/transfer-partners";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { UserId } from "../src/domain/shared/ids";
import { toLoyaltyAccountReadModel } from "../src/application/loyalty/mappers";
import { computePortfolioSummary } from "../src/application/loyalty/get-portfolio-summary";
import { rankTransferOptions } from "../src/domain/loyalty/transfer-ranking";

describe("exact point arithmetic", () => {
  const max = Number.MAX_SAFE_INTEGER;
  it("preserves safe sums and refuses an inexact number DTO", () => {
    expect(checkedPointSum([max - 1, 1])).toBe(max);
    expect(() => checkedPointSum([max, 1])).toThrow(InvalidBalanceError);
    for (const invalid of [-1, 1.5, Infinity, max + 1]) {
      expect(() => checkedPointSum([invalid])).toThrow(InvalidBalanceError);
    }
  });
  it("keeps multiplication exact before flooring", () => {
    expect(checkedPointRatio(max, 7, 10)).toBe(Number(BigInt(max) * 7n / 10n));
    expect(applyBonusPermille(max, 999)).toBe(Number(BigInt(max) * 999n / 1000n));
    expect(() => applyBonusPermille(max, 1001)).toThrow(InvalidBalanceError);
    expect(() => checkedPointRatio(1, 1, 0)).toThrow(InvalidBalanceError);
  });
  it("retains separate base and bonus floors for transfers", () => {
    const edge: TransferEdge = { fromProviderId: "amex-membership-rewards", toProviderId: "cathay-asia-miles", ratioFrom: 5, ratioTo: 4 };
    expect(convertPoints(edge, 10_001, 1250)).toBe(10_000);
    expect(convertPoints(edge, max)).toBe(Number(BigInt(max) * 4n / 5n));
    expect(() => convertPoints(edge, max + 1)).toThrow(InvalidBalanceError);
    expect(() => convertPoints({ ...edge, ratioFrom: NaN }, 1)).toThrow(InvalidBalanceError);
  });
  it("rounds published decimal valuations exactly without quantizing rates", () => {
    expect(estimateValueCents(5, 0.1)).toBe(1);
    expect(estimateValueCents(5000, 0.0001)).toBe(1);
    expect(estimateValueCents(5_000_000, 1e-7)).toBe(1);
    expect(estimateValueCents(max, 0.1)).toBe(Number((BigInt(max) + 5n) / 10n));
    expect(() => estimateValueCents(max, 2)).toThrow(InvalidBalanceError);
    expect(() => estimateValueCents(1, Infinity)).toThrow(InvalidValuationError);
  });
  function model(points: number, rate = 0.1) {
    const account = createLoyaltyAccount({ userId: UserId.parse("numeric-owner"), providerId: "united", membershipNumber: "synthetic" });
    const latest = createBalanceSnapshot({ loyaltyAccountId: account.id, points, source: "manual", capturedAt: new Date() });
    return toLoyaltyAccountReadModel(account, { latest, previous: null, asOf30Days: null, asOf90Days: null }, new Date(), new Map([["united", rate]]));
  }
  it("fails closed on portfolio point and money overflow despite valid rows", () => {
    expect(computePortfolioSummary([model(max - 1), model(1)]).totalPoints).toBe(max);
    expect(() => computePortfolioSummary([model(max), model(1)])).toThrow(InvalidBalanceError);
    expect(() => computePortfolioSummary([model(1, max), model(1, 1)])).toThrow(InvalidBalanceError);
  });
  it("refuses an account value outside the existing number DTO", () => {
    expect(model(5, 0.1).estimatedValueCents).toBe(1);
    expect(() => model(max, 2)).toThrow(InvalidBalanceError);
  });
  it("keeps normal transfer ranking and rejects unsafe value estimates", () => {
    expect(rankTransferOptions("chase-ultimate-rewards", 10_000).length).toBeGreaterThan(0);
    expect(() => rankTransferOptions("chase-ultimate-rewards", max)).toThrow(InvalidBalanceError);
  });
});
