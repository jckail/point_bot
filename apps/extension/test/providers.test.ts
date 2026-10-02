import { readFileSync } from "node:fs";
import { PROVIDER_CATALOG } from "@pointup/core/providers";
import { describe, expect, it } from "vitest";
import { GUIDED_PROVIDERS, guidedProviderForUrl, validateManualBalance } from "../src/providers";
import { PROVIDER_PAGE_RULES } from "../src/extraction";

describe("verified guided program catalog", () => {
  it("covers every core program with an audited official start link and matching currency", () => {
    const evidence = readFileSync(new URL("../../../docs/provider-capabilities.md", import.meta.url), "utf8");
    expect(GUIDED_PROVIDERS.map(p => p.id).sort()).toEqual(PROVIDER_CATALOG.map(p => p.id).sort());
    for (const provider of GUIDED_PROVIDERS) {
      expect(evidence).toContain(`(${provider.startUrl})`);
      expect(guidedProviderForUrl(provider.startUrl)).toBe(provider.id);
      expect(provider.currency).toBe(PROVIDER_CATALOG.find(p => p.id === provider.id)?.pointsCurrency);
      if (provider.pageReader) expect(PROVIDER_PAGE_RULES.some(r => r.providerId === provider.id)).toBe(true);
    }
  });
  it("recognizes official Bilt redirect hosts and only exact audited account hosts", () => {
    for (const host of ["www.bilt.com", "bilt.com", "www.biltrewards.com", "biltrewards.com"]) expect(guidedProviderForUrl(`https://${host}/`)).toBe("bilt");
    expect(guidedProviderForUrl("https://global.americanexpress.com/")).toBe("amex-membership-rewards");
    expect(guidedProviderForUrl("https://www.bilt.com.attacker.test/")).toBeNull();
    expect(guidedProviderForUrl("https://unknown.bilt.com/")).toBeNull();
  });
  it("rejects USD, ambiguous Rakuten units and invalid amounts", () => {
    expect(validateManualBalance("amtrak", 1234, "points").id).toBe("amtrak");
    for (const [program, points, unit] of [["bilt", 100, "usd"], ["rakuten", 100, "points"], ["amtrak", -1, "points"], ["amtrak", 1.5, "points"], ["unknown", 100, "points"]] as const) expect(() => validateManualBalance(program, points, unit)).toThrow();
  });
});
