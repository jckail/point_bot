import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENT_SKILL_CATALOG, isHostAllowed } from "@pointup/core";

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

// Synthetic examples only: these are not fixtures from authenticated bank pages.
const BANK_FIXTURES = [
  { providerId: "chase-ultimate-rewards", url: "https://ultimaterewardspoints.chase.com/rewards", program: "Ultimate Rewards", unit: "points" },
  { providerId: "amex-membership-rewards", url: "https://global.americanexpress.com/us/rewards", program: "Membership Rewards", unit: "points" },
  { providerId: "capital-one-miles", url: "https://myrewards.capitalone.com/rewards", program: "Capital One Rewards", unit: "miles" },
  { providerId: "bilt", url: "https://www.bilt.com/rewards", program: "Bilt Rewards", unit: "points" },
] as const;

describe("synthetic bank rewards capture", () => {
  it.each(BANK_FIXTURES)("recognizes program labels before and after the value for $providerId", ({ providerId, url, program, unit }) => {
    for (const text of [`${program} ${unit} balance: 48,320 ${unit}`, `${program} ${unit} balance: 48,320`, `${program} ${unit} balance: 48,320 ${unit}\nCash equivalent: $483.20`, `48,320 ${program} ${unit} balance`, `${program} ${unit}: 48,320 available`, `${program}\nAvailable ${unit}\n48,320`]) {
      expect(extractBalance({ url: `${url}?token=private#fragment`, text }), text).toEqual({ providerId, points: 48320, sourceUrl: url });
    }
  });
  it.each([
    ["https://myrewards.capitalone.com/rewards", "Capital One miles balance 100 dollars"],
    ["https://www.bilt.com/rewards", "Bilt points balance 50 Bilt Cash"],
    ["https://ultimaterewardspoints.chase.com/rewards", "Ultimate Rewards points balance $100"],
  ])("refuses currency attached to a rewards-labeled number (%s, %s)", (url, text) => {
    expect(extractBalance({ url, text })).toBeNull();
  });
  it.each(BANK_FIXTURES)("ignores cash, status, costs and promotional readings for $providerId", ({ url, program, unit }) => {
    const wrongUnit = unit === "points" ? "miles" : "points";
    for (const text of [`${program}\nCurrent cash balance $483.20`, `${program} status ${unit} balance: 48,320`, `Status: ${program} ${unit} balance: 48,320 ${unit}`, `Cash back: ${program} balance: 100 dollars`, `${program} balance: 100 dollars`, `${program} balance: 100`, `100 ${program} balance`, `${program} ${wrongUnit} balance: 100 ${wrongUnit}`, `${program} ${unit} balance: 100 dollars`, `${program} ${unit} balance: 100 ${wrongUnit}`, `Earn ${program} ${unit} balance: 48,320`, `${program}\nEarn 60,000 ${unit}`, `${program}\nRedeem for 48,320 ${unit}`, `Available balance 48,320 ${unit}`]) {
      expect(extractBalance({ url, text }), text).toBeNull();
    }
  });
  it.each(BANK_FIXTURES)("rejects malformed values and competing rewards balances for $providerId", ({ url, program, unit }) => {
    for (const value of ["-100", "− 100", "+100", "12.5", "1,,200", "12,34", "1 200", "1e3", String(Number.MAX_SAFE_INTEGER + 1)]) {
      expect(extractBalance({ url, text: `${program} ${unit} balance: ${value} ${unit}` }), value).toBeNull();
    }
    expect(extractBalance({ url, text: `${program} ${unit} balance: 1,000 ${unit}\n${program} ${unit} balance: 2,000 ${unit}` })).toBeNull();
    for (const points of [0, Number.MAX_SAFE_INTEGER]) expect(extractBalance({ url, text: `${program} ${unit} balance: ${points} ${unit}` })).toMatchObject({ points });
  });
  it.each(BANK_FIXTURES)("uses only exact core-approved rewards hosts for $providerId", ({ providerId, url }) => {
    const rule = PROVIDER_PAGE_RULES.find(rule => rule.providerId === providerId)!;
    const skill = AGENT_SKILL_CATALOG.find(skill => skill.id === `${providerId}.capture-balance`)!;
    expect(rule.exactHosts).toBe(true);
    expect(rule.unverifiedLive).toBe(true);
    for (const host of rule.hosts) {
      expect(isHostAllowed(skill, host), host).toBe(true);
      expect(detectProvider(host)?.providerId).toBe(providerId);
      expect(detectProvider(`account.${host}`)).toBeNull();
      expect(detectProvider(`${host}.evil.example`)).toBeNull();
    }
    expect(rule.hosts).toContain(new URL(url).hostname);
    expect(detectProvider("chase.com")).toBeNull();
    expect(detectProvider("americanexpress.com")).toBeNull();
    expect(detectProvider("capitalone.com")).toBeNull();
  });
  it("requires US Amex identity and refuses conflicting regional evidence", () => {
    const text = "Membership Rewards points balance: 48,320 points";
    const origin = "https://global.americanexpress.com";
    expect(extractBalance({ url: `${origin}/rewards`, text })).toBeNull();
    expect(extractBalance({ url: `${origin}/rewards`, text: `Country: United States\n${text}` })).toMatchObject({ providerId: "amex-membership-rewards", points: 48320 });
    expect(extractBalance({ url: `${origin}/en-us/rewards`, text })).toMatchObject({ points: 48320 });
    for (const region of ["ca", "uk", "sg", "au", "en-ca", "en-gb", "en-in", "en-nz", "fr-fr", "de-de", "fr", "en/in"]) expect(extractBalance({ url: `${origin}/${region}/rewards`, text: `Country: US\n${text}` }), region).toBeNull();
    for (const region of ["Canada", "United Kingdom", "Singapore", "Australia", "CA", "en-ca"]) expect(extractBalance({ url: `${origin}/us/rewards`, text: `Region: ${region}\n${text}` }), region).toBeNull();
  });
  it("supports the approved legacy Bilt hostname without trusting its subdomains", () => {
    expect(extractBalance({ url: "https://www.biltrewards.com/rewards", text: "Bilt points balance: 123 points" })).toMatchObject({ providerId: "bilt", points: 123 });
    expect(detectProvider("support.biltrewards.com")).toBeNull();
  });
});

describe("capture URL admission", () => {
  it.each(["http://www.united.com/account", "ftp://www.united.com/account", "https://user:password@www.united.com/account", "https://www.united.com:8443/account"])("refuses URLs rejected by the observation boundary (%s)", url => {
    expect(extractBalance({ url, text: "Available balance 1,000 miles" })).toBeNull();
  });
  it("allows standard HTTPS port and strips query/fragment as before", () => {
    expect(extractBalance({ url: "https://www.united.com:443/account?secret=value#fragment", text: "Available balance 1,000 miles" })).toEqual({ providerId: "united", points: 1000, sourceUrl: "https://www.united.com/account" });
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
