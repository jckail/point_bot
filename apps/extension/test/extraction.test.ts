import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  detectProvider,
  extractBalance,
  extractPointsWithRule,
  parsePoints,
  PROVIDER_PAGE_RULES,
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
    ).toEqual({ providerId: "united", points: 124_300 });
  });

  it("pulls Bonvoy points from a hotel page", () => {
    expect(
      extractBalance({
        url: "https://www.marriott.com/loyalty/myAccount.mi",
        text: "Your Bonvoy points: 88,200 points available",
      }),
    ).toEqual({ providerId: "marriott", points: 88_200 });
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
});

describe("extractPointsWithRule", () => {
  it("tries patterns in order and requires the keyword", () => {
    const rule = PROVIDER_PAGE_RULES.find((r) => r.providerId === "american")!;
    expect(extractPointsWithRule(rule, "45,000 AAdvantage miles")).toBe(45_000);
    expect(extractPointsWithRule(rule, "45,000 dollars")).toBeNull();
  });
});

describe("consent and conservative extraction", () => {
  it("has no automatic scripts or install-time provider/API host access", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../public/manifest.json", import.meta.url)), "utf8"));
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.permissions).toEqual(["storage", "activeTab", "scripting"]);
  });
  it("rejects promotions, ambiguous balances and insecure pages", () => {
    const url = "https://united.com/account";
    expect(extractBalance({ url, text: "Earn 50,000 miles today" })).toBeNull();
    expect(extractBalance({ url, text: "Balance 50,000 miles, upgrade costs 20,000 miles" })).toBeNull();
    expect(extractBalance({ url: "http://united.com", text: "Balance 50,000 miles" })).toBeNull();
    expect(extractBalance({ url, text: "Balance -50 miles" })).toBeNull();
    expect(extractBalance({ url, text: "Balance 12.5 miles" })).toBeNull();
    expect(extractBalance({ url, text: "Balance 1,23 miles" })).toBeNull();
  });
});
