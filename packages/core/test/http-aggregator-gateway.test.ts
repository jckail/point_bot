import { describe, expect, it } from "vitest";

import {
  HttpAggregatorTravelProviderGateway,
  type AggregatorFetch,
} from "../src/infrastructure/providers/http-aggregator-travel-provider-gateway";
import { CompositeTravelProviderGateway } from "../src/infrastructure/providers/composite-travel-provider-gateway";
import { SimulatedTravelProviderGateway } from "../src/infrastructure/providers/simulated-travel-provider-gateway";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";

function account(providerId = "united") {
  return createLoyaltyAccount({
    userId: "u",
    providerId,
    membershipNumber: "MP1",
  });
}

function stubFetch(
  handler: (url: string, body: unknown) => { ok: boolean; status?: number; text: string },
): { fetchImpl: AggregatorFetch; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: AggregatorFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const r = handler(url, body);
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), text: async () => r.text };
  };
  return { fetchImpl, calls };
}

describe("HttpAggregatorTravelProviderGateway", () => {
  it("posts to /v1/balance with auth and returns the rounded points", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      ok: true,
      text: JSON.stringify({ points: 124_300.6 }),
    }));
    const gw = new HttpAggregatorTravelProviderGateway({
      baseUrl: "https://api.aggr.test/",
      apiKey: "k",
      fetchImpl,
    });

    const balance = await gw.fetchBalance(account(), null);
    expect(balance).toEqual({ points: 124_301 });
    expect(calls[0]?.url).toBe("https://api.aggr.test/v1/balance");
    expect(calls[0]?.body).toMatchObject({
      providerId: "united",
      membershipNumber: "MP1",
    });
  });

  it("forwards a transient credential when provided", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      ok: true,
      text: JSON.stringify({ points: 10 }),
    }));
    const gw = new HttpAggregatorTravelProviderGateway({
      baseUrl: "https://a",
      apiKey: "k",
      fetchImpl,
    });
    await gw.fetchBalance(account(), { username: "user", secret: "pw" });
    expect(calls[0]?.body).toMatchObject({
      credential: { username: "user", secret: "pw" },
    });
  });

  it("throws on a non-2xx response and on an invalid balance", async () => {
    const failing = stubFetch(() => ({ ok: false, status: 502, text: "upstream down" }));
    await expect(
      new HttpAggregatorTravelProviderGateway({
        baseUrl: "https://a",
        apiKey: "k",
        fetchImpl: failing.fetchImpl,
      }).fetchBalance(account(), null),
    ).rejects.toThrow(/502/);

    const bad = stubFetch(() => ({ ok: true, text: JSON.stringify({ points: -5 }) }));
    await expect(
      new HttpAggregatorTravelProviderGateway({
        baseUrl: "https://a",
        apiKey: "k",
        fetchImpl: bad.fetchImpl,
      }).fetchBalance(account(), null),
    ).rejects.toThrow(/invalid balance/);
  });

  it("scopes support to configured providers", () => {
    const gw = new HttpAggregatorTravelProviderGateway({
      baseUrl: "https://a",
      apiKey: "k",
      supportedProviderIds: ["united", "delta"],
    });
    expect(gw.supports("united")).toBe(true);
    expect(gw.supports("hyatt")).toBe(false);
  });

  it("takes precedence over the simulated gateway in the composite", async () => {
    const { fetchImpl } = stubFetch(() => ({
      ok: true,
      text: JSON.stringify({ points: 999 }),
    }));
    const aggregator = new HttpAggregatorTravelProviderGateway({
      baseUrl: "https://a",
      apiKey: "k",
      supportedProviderIds: ["united"],
      fetchImpl,
    });
    const composite = new CompositeTravelProviderGateway([
      aggregator,
      new SimulatedTravelProviderGateway(),
    ]);

    // united → real aggregator (999); hyatt → simulated (deterministic hash).
    expect(await composite.fetchBalance(account("united"), null)).toEqual({
      points: 999,
    });
    const sim = await composite.fetchBalance(account("hyatt"), null);
    expect(sim.points).not.toBe(999);
  });
});
