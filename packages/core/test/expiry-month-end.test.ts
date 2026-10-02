import { describe, expect, it } from "vitest";

import { buildExpirationCalendar } from "../src/application/loyalty/build-expiration-calendar";
import { BuildPortfolioDigest } from "../src/application/loyalty/build-portfolio-digest";
import { deriveAlerts } from "../src/application/loyalty/derive-alerts";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { getProviderOrThrow, projectExpiryDate } from "../src/domain/loyalty/provider";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";
import { asUserId } from "./ids";

const owner = asUserId("month-end-owner");

describe("calendar-month expiry projections", () => {
  // These exercise existing editorial catalog durations, not verified issuer terms.
  it.each([
    ["wyndham-rewards", "2026-08-31T12:34:56.789Z", "2028-02-29T12:34:56.789Z"],
    ["wyndham-rewards", "2025-08-31T12:34:56.789Z", "2027-02-28T12:34:56.789Z"],
    ["american", "2024-02-29T12:34:56.789Z", "2026-02-28T12:34:56.789Z"],
    ["american", "2025-02-28T12:34:56.789Z", "2027-02-28T12:34:56.789Z"],
    ["wyndham-rewards", "2026-08-15T12:34:56.789Z", "2028-02-15T12:34:56.789Z"],
    ["american", "2026-12-31T12:34:56.789Z", "2028-12-31T12:34:56.789Z"],
  ])("persists %s expiry from %s as %s on linking", async (providerId, start, expected) => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const now = new Date(start);
    const result = await new LinkLoyaltyAccount(accounts, undefined, { now: () => now }).execute({
      userId: owner, providerId, membershipNumber: "fixture-member",
    });

    expect((await accounts.findById(result.accountId))?.expiresAt?.toISOString()).toBe(expected);
    expect(now.toISOString()).toBe(start);
  });

  it("uses the clamped activity deadline in expired alerts and the calendar", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    let now = new Date("2026-07-01T12:34:56.789Z");
    const clock = { now: () => now };
    const result = await new LinkLoyaltyAccount(accounts, undefined, clock).execute({
      userId: owner, providerId: "wyndham-rewards", membershipNumber: "fixture-member",
    });
    now = new Date("2026-08-31T12:34:56.789Z");
    await new RecordManualBalance(accounts, balances, undefined, clock).execute({
      userId: owner, accountId: result.accountId, points: 1000,
    });
    expect((await accounts.findById(result.accountId))?.expiresAt?.toISOString())
      .toBe("2028-02-29T12:34:56.789Z");

    now = new Date("2028-02-29T12:34:56.789Z");
    const digest = await new BuildPortfolioDigest(new ListLoyaltyAccounts(accounts, balances, clock)).execute(owner);
    expect(digest.accounts[0]?.daysUntilExpiry).toBe(-1);
    expect(digest.expiring.map(account => account.id)).toEqual([result.accountId]);
    expect(deriveAlerts(digest)).toEqual([expect.objectContaining({ type: "expired", providerId: "wyndham-rewards" })]);
    const calendar = buildExpirationCalendar(digest.accounts);
    expect(calendar).toContain("DTSTART;VALUE=DATE:20280229\r\n");
    expect(calendar).not.toContain("DTSTART;VALUE=DATE:20280302");
  });

  it("keeps null-policy accounts without expiry through linking and activity", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const clock = { now: () => new Date("2026-08-31T12:34:56.789Z") };
    const result = await new LinkLoyaltyAccount(accounts, undefined, clock).execute({
      userId: owner, providerId: "delta", membershipNumber: "fixture-member",
    });
    expect((await accounts.findById(result.accountId))?.expiresAt).toBeNull();
    await new RecordManualBalance(accounts, balances, undefined, clock).execute({
      userId: owner, accountId: result.accountId, points: 1000,
    });
    const digest = await new BuildPortfolioDigest(new ListLoyaltyAccounts(accounts, balances, clock)).execute(owner);
    expect(digest.accounts[0]?.expiresAt).toBeNull();
    expect(digest.accounts[0]?.daysUntilExpiry).toBeNull();
    expect(deriveAlerts(digest)).toEqual([]);
    expect(buildExpirationCalendar(digest.accounts)).not.toContain("BEGIN:VEVENT");
  });

  it("leaves explicit expiry overrides intact and never mutates the reference date", () => {
    const start = new Date("2026-08-31T12:34:56.789Z");
    const override = new Date("2030-03-02T01:02:03.004Z");
    const account = createLoyaltyAccount({
      userId: owner, providerId: "wyndham-rewards", membershipNumber: "fixture-member",
      now: start, expiresAt: override,
    });
    expect(account.expiresAt).toEqual(override);
    expect(projectExpiryDate(getProviderOrThrow("wyndham-rewards"), start)?.toISOString())
      .toBe("2028-02-29T12:34:56.789Z");
    expect(start.toISOString()).toBe("2026-08-31T12:34:56.789Z");
    expect(override.toISOString()).toBe("2030-03-02T01:02:03.004Z");
  });
});
