import { describe, expect, it } from "vitest";

import { AIRLINE_PROVIDERS } from "../src/domain/loyalty/catalog/airlines";
import { ALLIANCES } from "../src/domain/loyalty/catalog/types";
import type { ProviderDefinition } from "../src/domain/loyalty/provider";

describe("airline catalog", () => {
  it("is broad, all airline kind, with valid alliances and regions", () => {
    expect(AIRLINE_PROVIDERS.length).toBeGreaterThanOrEqual(40);
    const providers: readonly ProviderDefinition[] = AIRLINE_PROVIDERS;
    for (const p of providers) {
      expect(p.kind).toBe("airline");
      if (p.alliance) expect(ALLIANCES).toContain(p.alliance);
      if (p.region) expect(p.region).toMatch(/^[A-Z]{2}$/);
      expect(p.estimatedCentsPerPoint).toBeGreaterThan(0);
    }
  });
  it("keeps the original US programs", () => {
    const ids = AIRLINE_PROVIDERS.map((p) => p.id);
    for (const id of ["united", "delta", "american"]) expect(ids).toContain(id);
  });
});
