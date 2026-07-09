import { describe, expect, it } from "vitest";

import {
  HTTP_STATUS_BY_ERROR_CODE,
  httpStatusForErrorCode,
  linkLoyaltyAccountRequestSchema,
  recordManualBalanceRequestSchema,
  providerKindSchema,
} from "../src/contracts/index";
import {
  AccountNotRestorableError,
  AssistantUnavailableError,
  CredentialUnavailableError,
  DemoPortfolioNotEmptyError,
  DuplicateLoyaltyAccountError,
  InvalidAccountNotesError,
  InvalidAccountTagError,
  InvalidAssistantMessageError,
  InvalidBalanceError,
  InvalidCaptureTimeError,
  InvalidGoalTargetError,
  InvalidGoalTitleError,
  InvalidImportError,
  InvalidMembershipNumberError,
  InvalidScrapeUrlError,
  LoyaltyAccountNotFoundError,
  ProviderNotSupportedError,
  ScrapeFailedError,
  ShareLinkNotFoundError,
  TripGoalNotFoundError,
} from "../src/domain/errors";
import {
  estimateValueCents,
  PROVIDER_CATALOG,
  PROVIDER_KIND_LABELS,
  PROVIDER_KINDS,
} from "../src/domain/loyalty/provider";

describe("provider catalog", () => {
  it("has unique ids and only cataloged kinds", () => {
    const ids = PROVIDER_CATALOG.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const provider of PROVIDER_CATALOG) {
      expect(PROVIDER_KINDS).toContain(provider.kind);
    }
  });

  it("labels every kind", () => {
    for (const kind of PROVIDER_KINDS) {
      expect(PROVIDER_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("covers credit cards, rail, and shopping programs", () => {
    const kinds = new Set(PROVIDER_CATALOG.map((provider) => provider.kind));
    expect(kinds).toContain("credit_card");
    expect(kinds).toContain("rail");
    expect(kinds).toContain("shopping");
  });

  it("gives every provider a positive valuation estimate", () => {
    for (const provider of PROVIDER_CATALOG) {
      expect(provider.estimatedCentsPerPoint).toBeGreaterThan(0);
    }
  });

  it("rounds estimated value to whole cents", () => {
    const hilton = PROVIDER_CATALOG.find((p) => p.id === "hilton")!;
    expect(estimateValueCents(hilton, 1001)).toBe(501); // 1001 * 0.5 = 500.5
  });
});

describe("request schema strictness", () => {
  it("rejects unknown keys", () => {
    const result = linkLoyaltyAccountRequestSchema.safeParse({
      providerId: "united",
      membershipNumber: "MP1",
      membershipNo: "typo",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a strict ISO UTC capture time and rejects loose dates", () => {
    expect(
      recordManualBalanceRequestSchema.safeParse({
        points: 100,
        capturedAt: "2026-07-08T14:03:00.000Z",
      }).success,
    ).toBe(true);

    // Date-only and offset-bearing timestamps are not valid on the wire.
    expect(
      recordManualBalanceRequestSchema.safeParse({
        points: 100,
        capturedAt: "2026-07-08",
      }).success,
    ).toBe(false);
    expect(
      recordManualBalanceRequestSchema.safeParse({
        points: 100,
        capturedAt: "2026-07-08T14:03:00+02:00",
      }).success,
    ).toBe(false);
  });

  it("kind schema matches the domain catalog", () => {
    for (const kind of PROVIDER_KINDS) {
      expect(providerKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(providerKindSchema.safeParse("cruise").success).toBe(false);
  });
});

describe("error code -> HTTP status contract", () => {
  it("covers every domain error code", () => {
    const domainErrors = [
      new ProviderNotSupportedError("x"),
      new DuplicateLoyaltyAccountError("x"),
      new LoyaltyAccountNotFoundError("x"),
      new InvalidMembershipNumberError(),
      new InvalidBalanceError(),
      new InvalidCaptureTimeError("x"),
      new CredentialUnavailableError("x"),
      new TripGoalNotFoundError("x"),
      new InvalidGoalTitleError(),
      new InvalidGoalTargetError(),
      new InvalidImportError("x"),
      new InvalidAccountNotesError(),
      new InvalidAccountTagError("x"),
      new AccountNotRestorableError("x"),
      new DemoPortfolioNotEmptyError(),
      new ShareLinkNotFoundError(),
      new AssistantUnavailableError("x"),
      new ScrapeFailedError("x"),
      new InvalidAssistantMessageError(),
      new InvalidScrapeUrlError(),
    ];
    for (const error of domainErrors) {
      expect(
        HTTP_STATUS_BY_ERROR_CODE,
        `missing status for ${error.code}`,
      ).toHaveProperty(error.code);
    }
  });

  it("defaults unknown codes to 400", () => {
    expect(httpStatusForErrorCode("SOME_FUTURE_CODE")).toBe(400);
    expect(httpStatusForErrorCode("LOYALTY_ACCOUNT_NOT_FOUND")).toBe(404);
    expect(httpStatusForErrorCode("UNAUTHENTICATED")).toBe(401);
  });
});
