import { describe, expect, it, vi } from "vitest";
import type {
  LoyaltyAccountReadModel,
  ValueAdviceReadModel,
} from "@pointup/core";

import { handleCommand, type BotUseCases } from "../src/commands";

function account(
  over: Partial<LoyaltyAccountReadModel> & {
    displayName: string;
    kind?: LoyaltyAccountReadModel["provider"]["kind"];
    points?: number | null;
    valueCents?: number;
    daysUntilExpiry?: number | null;
  },
): LoyaltyAccountReadModel {
  const { displayName, kind, points, valueCents, daysUntilExpiry, ...rest } = over;
  return {
    id: displayName.toLowerCase(),
    provider: {
      id: displayName.toLowerCase(),
      kind: kind ?? "airline",
      displayName,
      pointsCurrency: "points",
      estimatedCentsPerPoint: 1.3,
      inactivityExpiryMonths: 18,
    },
    membershipNumber: "X",
    hasStoredCredential: false,
    latestBalance:
      points == null
        ? null
        : { points, source: "manual", capturedAt: new Date("2026-01-01") },
    estimatedValueCents: valueCents ?? 0,
    trend: {} as LoyaltyAccountReadModel["trend"],
    expiresAt: null,
    daysUntilExpiry: daysUntilExpiry ?? null,
    notes: null,
    tags: [],
    pinnedAt: null,
    createdAt: new Date("2026-01-01"),
    ...rest,
  };
}

function useCases(over: Partial<BotUseCases> = {}): BotUseCases {
  return {
    listAccounts: { execute: vi.fn(async () => []) },
    getValueAdvice: {
      execute: vi.fn(
        async (): Promise<ValueAdviceReadModel> => ({ transfers: [], deals: [] }),
      ),
    },
    chatWithAssistant: { execute: vi.fn(async () => ({ reply: "assistant reply" })) },
    ...over,
  };
}

describe("handleCommand", () => {
  it("help (and empty input) lists commands", async () => {
    expect(await handleCommand({ userId: "u", text: "" }, useCases())).toContain(
      "PointBot commands",
    );
    expect(await handleCommand({ userId: "u", text: "help" }, useCases())).toContain(
      "`ask <question>`",
    );
  });

  it("portfolio summarizes balances", async () => {
    const uc = useCases({
      listAccounts: {
        execute: vi.fn(async () => [
          account({ displayName: "Hyatt", kind: "hotel", points: 100_000, valueCents: 170_000 }),
          account({ displayName: "United", points: 50_000, valueCents: 60_000 }),
        ]),
      },
    });
    const out = await handleCommand({ userId: "u", text: "portfolio" }, uc);
    expect(out).toContain("2 programs");
    expect(out).toContain("Hyatt");
    // Most valuable first.
    expect(out.indexOf("Hyatt")).toBeLessThan(out.indexOf("United"));
  });

  it("expiring lists at-risk programs soonest first", async () => {
    const uc = useCases({
      listAccounts: {
        execute: vi.fn(async () => [
          account({ displayName: "Delta", points: 1000, daysUntilExpiry: 40 }),
          account({ displayName: "Marriott", kind: "hotel", points: 1000, daysUntilExpiry: 5 }),
          account({ displayName: "Amex", kind: "credit_card", points: 1000, daysUntilExpiry: null }),
        ]),
      },
    });
    const out = await handleCommand({ userId: "u", text: "expiring" }, uc);
    expect(out).toContain("Marriott");
    expect(out.indexOf("Marriott")).toBeLessThan(out.indexOf("Delta"));
    expect(out).not.toContain("Amex"); // no expiry -> not at risk
  });

  it("value shows advice and the transfer disclaimer", async () => {
    const uc = useCases({
      getValueAdvice: {
        execute: vi.fn(
          async (): Promise<ValueAdviceReadModel> => ({
            transfers: [
              {
                from: { displayName: "Chase UR" },
                to: { displayName: "Hyatt" },
                sourcePoints: 100_000,
                destinationPoints: 100_000,
                effectiveCentsPerPoint: 2.1,
                bonusLabel: null,
              },
            ] as ValueAdviceReadModel["transfers"],
            deals: [],
          }),
        ),
      },
    });
    const out = await handleCommand({ userId: "u", text: "value" }, uc);
    expect(out).toContain("Chase UR");
    expect(out).toContain("irreversible");
  });

  it("ask routes to the assistant with the question", async () => {
    const execute = vi.fn(async () => ({ reply: "Transfer to Hyatt." }));
    const uc = useCases({ chatWithAssistant: { execute } });
    const out = await handleCommand(
      { userId: "u", text: "ask should I move UR to Hyatt?" },
      uc,
    );
    expect(out).toBe("Transfer to Hyatt.");
    expect(execute).toHaveBeenCalledWith({
      userId: "u",
      message: "should I move UR to Hyatt?",
    });
  });

  it("unrecognized text is treated as a free-form assistant question", async () => {
    const execute = vi.fn(async () => ({ reply: "answer" }));
    const uc = useCases({ chatWithAssistant: { execute } });
    await handleCommand({ userId: "u", text: "what's my best redemption" }, uc);
    expect(execute).toHaveBeenCalledWith({
      userId: "u",
      message: "what's my best redemption",
    });
  });
});
