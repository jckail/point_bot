import { describe, expect, it } from "vitest";

import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { ListTripGoals } from "../src/application/loyalty/list-trip-goals";
import { DeleteTripGoal, UpdateTripGoal } from "../src/application/loyalty/update-trip-goal";
import { ImportPortfolio } from "../src/application/loyalty/import-portfolio";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { buildExpirationCalendar } from "../src/application/loyalty/build-expiration-calendar";
import { toPortfolioExportCsv } from "../src/contracts/index";
import {
  InvalidGoalTargetError,
  InvalidGoalTitleError,
  InvalidImportError,
  TripGoalNotFoundError,
} from "../src/domain/errors";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { computeGoalProgress, createTripGoal } from "../src/domain/loyalty/trip-goal";
import type { LoyaltyAccountReadModel } from "../src/application/loyalty/read-models";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
  InMemoryTripGoalRepository,
} from "./fakes";

describe("computeGoalProgress", () => {
  it("sums linked balances against the target", () => {
    const goal = createTripGoal({
      userId: "u1",
      title: "Kyoto",
      targetPoints: 80_000,
      accountIds: ["a1", "a2"],
    });
    const progress = computeGoalProgress(
      goal,
      new Map([
        ["a1", 50_000],
        ["a2", 20_000],
      ]),
    );
    expect(progress.currentPoints).toBe(70_000);
    expect(progress.remainingPoints).toBe(10_000);
    expect(progress.percentComplete).toBe(87.5);
    expect(progress.achieved).toBe(false);
  });

  it("marks achieved when balances meet the target", () => {
    const goal = createTripGoal({
      userId: "u1",
      title: "Done",
      targetPoints: 10_000,
      accountIds: ["a1"],
    });
    const progress = computeGoalProgress(goal, new Map([["a1", 10_000]]));
    expect(progress.achieved).toBe(true);
    expect(progress.remainingPoints).toBe(0);
    expect(progress.percentComplete).toBe(100);
  });
});

describe("CreateTripGoal / ListTripGoals", () => {
  it("creates a goal and reports progress from balances", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const goals = new InMemoryTripGoalRepository();

    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "hilton",
      membershipNumber: "HH1",
      id: "acct-1",
    });
    await accounts.insert(account);
    await balances.insert(
      createBalanceSnapshot({
        loyaltyAccountId: "acct-1",
        points: 40_000,
        source: "manual",
        capturedAt: new Date("2026-07-01T00:00:00.000Z"),
      }),
    );

    const created = await new CreateTripGoal(goals, accounts, balances).execute({
      userId: "user-1",
      title: "Weekend getaway",
      targetPoints: 50_000,
      accountIds: ["acct-1"],
      targetDate: "2026-12-01",
    });

    expect(created.currentPoints).toBe(40_000);
    expect(created.percentComplete).toBe(80);

    const listed = await new ListTripGoals(goals, balances).execute("user-1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("Weekend getaway");
  });

  it("rejects blank titles and non-positive targets", async () => {
    const useCase = new CreateTripGoal(
      new InMemoryTripGoalRepository(),
      new InMemoryLoyaltyAccountRepository(),
      new InMemoryBalanceSnapshotRepository(),
    );

    await expect(
      useCase.execute({
        userId: "u1",
        title: "  ",
        targetPoints: 1000,
      }),
    ).rejects.toBeInstanceOf(InvalidGoalTitleError);

    await expect(
      useCase.execute({
        userId: "u1",
        title: "Trip",
        targetPoints: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidGoalTargetError);
  });

  it("updates and deletes goals", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const goals = new InMemoryTripGoalRepository();
    const create = new CreateTripGoal(goals, accounts, balances);
    const update = new UpdateTripGoal(goals, accounts, balances);
    const remove = new DeleteTripGoal(goals);

    const goal = await create.execute({
      userId: "user-1",
      title: "Original",
      targetPoints: 10_000,
    });

    const updated = await update.execute({
      userId: "user-1",
      goalId: goal.id,
      title: "Renamed",
      status: "archived",
    });
    expect(updated.title).toBe("Renamed");
    expect(updated.status).toBe("archived");

    await remove.execute("user-1", goal.id);
    expect(await goals.findById(goal.id)).toBeNull();

    await expect(remove.execute("user-1", goal.id)).rejects.toBeInstanceOf(
      TripGoalNotFoundError,
    );
  });
});

describe("ImportPortfolio", () => {
  it("links accounts and records balances from an export CSV", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const link = new LinkLoyaltyAccount(accounts);
    const record = new RecordManualBalance(accounts, balances);
    const importer = new ImportPortfolio(accounts, link, record);

    const csv = [
      "accountId,providerId,providerKind,providerName,membershipNumber,points,source,capturedAt,estimatedValueCents",
      "old-id,united,airline,United Airlines,MP123,48000,manual,2026-06-01T12:00:00.000Z,57600",
      "old-id,united,airline,United Airlines,MP123,50000,sync,2026-07-01T12:00:00.000Z,60000",
    ].join("\n");

    const result = await importer.execute({ userId: "user-1", csv });
    expect(result.accountsLinked).toBe(1);
    expect(result.balancesRecorded).toBe(2);

    const linked = await accounts.findByUserAndProvider("user-1", "united");
    expect(linked?.membershipNumber).toBe("MP123");
    const history = await balances.findByAccountId(linked!.id, 10);
    expect(history).toHaveLength(2);
  });

  it("rejects CSV without required columns", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const importer = new ImportPortfolio(
      accounts,
      new LinkLoyaltyAccount(accounts),
      new RecordManualBalance(accounts, new InMemoryBalanceSnapshotRepository()),
    );

    await expect(
      importer.execute({
        userId: "user-1",
        csv: "foo,bar\n1,2\n",
      }),
    ).rejects.toBeInstanceOf(InvalidImportError);
  });

  it("round-trips through toPortfolioExportCsv shape", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const link = new LinkLoyaltyAccount(accounts);
    const record = new RecordManualBalance(accounts, balances);

    await link.execute({
      userId: "user-1",
      providerId: "delta",
      membershipNumber: "DL9",
    });
    const account = (await accounts.findByUserId("user-1"))[0]!;
    await record.execute({
      userId: "user-1",
      accountId: account.id,
      points: 12_000,
      capturedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    const csv = toPortfolioExportCsv({
      exportedAt: new Date("2026-07-08T00:00:00.000Z"),
      accounts: [
        {
          account: {
            id: account.id,
            provider: {
              id: "delta",
              kind: "airline",
              displayName: "Delta Air Lines",
              pointsCurrency: "SkyMiles",
              estimatedCentsPerPoint: 1.2,
              inactivityExpiryMonths: 24,
            },
            membershipNumber: "DL9",
            hasStoredCredential: false,
            latestBalance: {
              points: 12_000,
              source: "manual",
              capturedAt: new Date("2026-05-01T00:00:00.000Z"),
            },
            estimatedValueCents: 14400,
            customCentsPerPoint: null,
            trend: {
              sincePrevious: null,
              since30Days: null,
              since90Days: null,
            },
            expiresAt: null,
            daysUntilExpiry: null,
            notes: null,
            tags: [],
            pinnedAt: null,
            createdAt: account.createdAt,
          },
          history: [
            {
              points: 12_000,
              source: "manual",
              capturedAt: new Date("2026-05-01T00:00:00.000Z"),
            },
          ],
        },
      ],
    });

    // Wipe and re-import into a fresh user.
    const accounts2 = new InMemoryLoyaltyAccountRepository();
    const balances2 = new InMemoryBalanceSnapshotRepository();
    const result = await new ImportPortfolio(
      accounts2,
      new LinkLoyaltyAccount(accounts2),
      new RecordManualBalance(accounts2, balances2),
    ).execute({ userId: "user-2", csv });

    expect(result.accountsLinked).toBe(1);
    expect(result.balancesRecorded).toBe(1);
  });
});

describe("buildExpirationCalendar", () => {
  it("emits VEVENT rows for accounts with expiry dates", () => {
    const accounts: LoyaltyAccountReadModel[] = [
      {
        id: "acct-1",
        provider: {
          id: "united",
          kind: "airline",
          displayName: "United Airlines",
          pointsCurrency: "MileagePlus miles",
          estimatedCentsPerPoint: 1.2,
          inactivityExpiryMonths: 18,
        },
        membershipNumber: "MP1",
        hasStoredCredential: false,
        latestBalance: {
          points: 10_000,
          source: "sync",
          capturedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        estimatedValueCents: 12000,
        customCentsPerPoint: null,
        trend: {
          sincePrevious: null,
          since30Days: null,
          since90Days: null,
        },
        expiresAt: new Date("2026-12-15T00:00:00.000Z"),
        daysUntilExpiry: 150,
        notes: null,
        tags: [],
        pinnedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];

    const ics = buildExpirationCalendar(accounts);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:United Airlines points expire");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261215");
    expect(ics).toContain("END:VCALENDAR");
  });
});
