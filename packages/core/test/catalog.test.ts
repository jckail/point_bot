import { describe, expect, it } from "vitest";

import { AGENT_SKILL_CATALOG } from "../src/domain/agent/skill";
import {
  CATALOG_CONFIDENCE,
  PROVIDER_CATALOG,
  PROVIDER_KINDS,
} from "../src/domain/loyalty/provider";
import { TRANSFER_EDGES } from "../src/domain/loyalty/transfer-partners";

/**
 * Integrity guard for the provider catalog. Researchers extend the per-kind
 * files in domain/loyalty/catalog; this test keeps that data coherent.
 */
describe("provider catalog integrity", () => {
  it("has unique, url-safe ids", () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("uses only known kinds and confidence levels, with sane numbers", () => {
    for (const p of PROVIDER_CATALOG) {
      expect(PROVIDER_KINDS).toContain(p.kind);
      expect(CATALOG_CONFIDENCE).toContain(p.confidence);
      expect(p.estimatedCentsPerPoint).toBeGreaterThan(0);
      expect(p.estimatedCentsPerPoint).toBeLessThanOrEqual(100);
      if (p.inactivityExpiryMonths !== null) {
        expect(Number.isInteger(p.inactivityExpiryMonths)).toBe(true);
        expect(p.inactivityExpiryMonths).toBeGreaterThan(0);
      }
      expect(p.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.displayName.length).toBeGreaterThan(1);
    }
  });

  it("agent skill seeds are https, on their own allowed hosts, with valid dates", () => {
    for (const p of PROVIDER_CATALOG) {
      const seed = p.agentSkill;
      if (!seed) continue;
      const url = new URL(seed.startUrl);
      expect(url.protocol, p.id).toBe("https:");
      expect(
        seed.allowedHosts.some(
          (h) => url.hostname === h || url.hostname.endsWith(`.${h}`),
        ),
        `${p.id} start URL host must be allow-listed`,
      ).toBe(true);
      for (const host of seed.allowedHosts) {
        expect(host, p.id).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      }
      if (seed.verifiedAt) expect(seed.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("generates exactly a browser + computer skill per seeded provider", () => {
    const seeded = PROVIDER_CATALOG.filter((p) => p.agentSkill).map((p) => p.id);
    expect(new Set(AGENT_SKILL_CATALOG.map((s) => s.providerId))).toEqual(
      new Set(seeded),
    );
    expect(AGENT_SKILL_CATALOG.length).toBe(seeded.length * 2);
  });

  it("transfer edges reference cataloged providers and sane ratios", () => {
    const ids = new Set(PROVIDER_CATALOG.map((p) => p.id));
    const seen = new Set<string>();
    for (const e of TRANSFER_EDGES) {
      expect(ids.has(e.fromProviderId), `unknown from ${e.fromProviderId}`).toBe(true);
      expect(ids.has(e.toProviderId), `unknown to ${e.toProviderId}`).toBe(true);
      expect(e.fromProviderId).not.toBe(e.toProviderId);
      expect(e.ratioFrom).toBeGreaterThan(0);
      expect(e.ratioTo).toBeGreaterThan(0);
      const key = `${e.fromProviderId}>${e.toProviderId}`;
      expect(seen.has(key), `duplicate edge ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
