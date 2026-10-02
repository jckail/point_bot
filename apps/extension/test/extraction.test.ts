import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  detectProvider,
  extractBalance,
  extractPointsWithRule,
  parsePoints,
  PROVIDER_PAGE_RULES,
  providerHostGlobs,
} from "../src/extraction";

describe("parsePoints", () => {
  it("parses comma-grouped integers", () => {
    expect(parsePoints("1,234,567")).toBe(1234567);
    expect(parsePoints("500")).toBe(500);
  });
  it("rejects non-integers", () => {
    expect(parsePoints("12.5")).toBeNull();
    expect(parsePoints("abc")).toBeNull();
    expect(parsePoints("")).toBeNull();
  });
  it("rejects malformed grouping and unsafe integers without changing whole values", () => {
    for (const raw of ["1,,200", "12,34", ",123", "123,", "1234,567", "-100", "12.5", String(Number.MAX_SAFE_INTEGER + 1)]) expect(parsePoints(raw), raw).toBeNull();
    expect(parsePoints("0")).toBe(0);
    expect(parsePoints(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("detectProvider", () => {
  it("matches exact and subdomain hosts", () => {
    expect(detectProvider("www.united.com")?.providerId).toBe("united");
    expect(detectProvider("united.com")?.providerId).toBe("united");
    expect(detectProvider("account.marriott.com")?.providerId).toBe("marriott");
  });
  it("returns null for unknown hosts", () => {
    expect(detectProvider("example.com")).toBeNull();
    // Guard against a naive substring match on a look-alike domain.
    expect(detectProvider("notunited.com")).toBeNull();
  });
});

describe("extractBalance", () => {
  it("pulls miles from an airline page", () => {
    expect(
      extractBalance({
        url: "https://www.united.com/en/us/account",
        text: "MileagePlus\nAvailable balance\n124,300 miles",
      }),
    ).toMatchObject({ providerId: "united", points: 124_300 });
  });

  it("pulls Bonvoy points from a hotel page", () => {
    expect(
      extractBalance({
        url: "https://www.marriott.com/loyalty/myAccount.mi",
        text: "Your Bonvoy points: 88,200 points available",
      }),
    ).toMatchObject({ providerId: "marriott", points: 88_200 });
  });

  it("returns null on a provider page with no balance", () => {
    expect(
      extractBalance({ url: "https://www.hyatt.com/", text: "Book a hotel" }),
    ).toBeNull();
  });

  it("returns null off a known provider", () => {
    expect(
      extractBalance({ url: "https://news.example.com/", text: "1,000 points" }),
    ).toBeNull();
  });

  it("returns null for a malformed url", () => {
    expect(extractBalance({ url: "not a url", text: "1 miles" })).toBeNull();
  });

  it.each(["12.5", "-100", "- 100", "−100", "− 100", "+100", "1,,200", "12,34", "1e3", "1_000", "1 200", String(Number.MAX_SAFE_INTEGER + 1)])("refuses malformed or partial numeric readings (%s)", value => {
    expect(extractBalance({ url: "https://www.united.com/account", text: `Available balance ${value} miles` })).toBeNull();
  });
  it("refuses a competing promotional amount instead of choosing the first number", () => {
    for (const text of ["Earn 60,000 miles\nAvailable balance 124,300 miles", "Available balance 124,300 miles\nEarn 60,000 miles", "Available balance 1,000 miles\nAnother account balance 2,000 miles"]) {
      expect(extractBalance({ url: "https://www.united.com/account", text }), text).toBeNull();
    }
  });
  it.each(["Earn 60,000 miles", "Redeem 25,000 miles", "Up to 30,000 miles", "1,000 miles per flight", "Your offer: 1,000 miles"])("does not treat promotional or unlabeled page text as a balance (%s)", text => {
    expect(extractBalance({ url: "https://www.united.com/account", text })).toBeNull();
  });
  it("accepts repeated copies of one labeled balance while preserving a query-free source URL", () => {
    expect(extractBalance({ url: "https://www.united.com/account?token=secret#fragment", text: "Available balance 124,300 miles\n124,300 miles available" }))
      .toEqual({ providerId: "united", points: 124300, sourceUrl: "https://www.united.com/account" });
  });
  it("keeps zero and large safe-integer labeled balances available", () => {
    for (const points of [0, 2_147_483_648, Number.MAX_SAFE_INTEGER]) {
      expect(extractBalance({ url: "https://www.united.com/account", text: `Available miles: ${points} miles` })).toMatchObject({ points });
    }
  });
  it.each([
    ["delta.com", "SkyMiles\nAvailable balance 12,000 miles", "delta"],
    ["aa.com", "You have 45,000 AAdvantage miles", "american"],
    ["southwest.com", "Available balance 9,000 Rapid Rewards points", "southwest"],
    ["hyatt.com", "Points balance: 8,000 points", "hyatt"],
    ["hilton.com", "Your points: 7,000 points", "hilton"],
  ])("preserves labeled balance readings for %s", (host, text, providerId) => {
    expect(extractBalance({ url: `https://www.${host}/account`, text })).toMatchObject({ providerId });
  });
});

describe("extractPointsWithRule", () => {
  it("accepts an isolated labeled-unit value and requires the keyword", () => {
    const rule = PROVIDER_PAGE_RULES.find((r) => r.providerId === "american")!;
    expect(extractPointsWithRule(rule, "45,000 AAdvantage miles")).toBe(45_000);
    expect(extractPointsWithRule(rule, "45,000 dollars")).toBeNull();
  });
});

describe("manifest stays in sync with the rules", () => {
  it("content_scripts matches equal providerHostGlobs()", () => {
    const manifestPath = fileURLToPath(
      new URL("../public/manifest.json", import.meta.url),
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      content_scripts: { matches: string[] }[];
    };
    const matches = manifest.content_scripts[0]!.matches;
    expect([...matches].sort()).toEqual([...providerHostGlobs()].sort());
  });
});
