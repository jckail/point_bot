import { describe, expect, it } from "vitest";

import { HOTEL_PROVIDERS } from "../src/domain/loyalty/catalog/hotels";
import { TRAVEL_PROVIDERS } from "../src/domain/loyalty/catalog/travel";
import type { ProviderDefinition } from "../src/domain/loyalty/provider";

describe("hotel and travel catalog", () => {
  it("hotels are all kind hotel", () => {
    for (const p of HOTEL_PROVIDERS) expect(p.kind).toBe("hotel");
  });

  it("travel covers car rental, cruise and rideshare only", () => {
    const kinds = new Set(TRAVEL_PROVIDERS.map((p) => p.kind));
    expect(kinds).toEqual(new Set(["car_rental", "cruise", "rideshare"]));
  });

  it("rideshare skills warn about dollars vs points", () => {
    for (const id of ["uber-rewards", "lyft-rewards"]) {
      const providers: readonly ProviderDefinition[] = TRAVEL_PROVIDERS;
      const p = providers.find((x) => x.id === id);
      expect(p?.agentSkill?.notes?.length).toBeGreaterThan(0);
    }
  });
});
