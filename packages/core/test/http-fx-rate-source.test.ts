import { describe, expect, it } from "vitest";
import { HttpFxRateSource } from "../src/infrastructure/fx/fx-rate-sources";

function source(payload: unknown) {
  return new HttpFxRateSource({ baseUrl: "https://synthetic.test", fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) }) });
}

describe("HTTP FX base currency contract", () => {
  it.each(["EUR", "usd", "USD ", "", null, 1, {}, []])("rejects malformed or non-USD supplied base: %j", async base => {
    await expect(source({ base, rates: { GBP: 0.8 } }).getUsdRate("GBP")).rejects.toThrow("invalid USD base currency");
  });
  it("accepts explicit USD and preserves no-base compatible responses", async () => {
    expect(await source({ base: "USD", rates: { GBP: 0.8 } }).getUsdRate("GBP")).toBe(0.8);
    expect(await source({ rates: { GBP: 0.8 } }).getUsdRate("GBP")).toBe(0.8);
  });
  it("does not cache a rejected non-USD rate", async () => {
    let calls = 0;
    const fx = new HttpFxRateSource({ baseUrl: "https://synthetic.test", fetchImpl: async () => ({
      ok: true, status: 200, text: async () => JSON.stringify({ base: ++calls === 1 ? "EUR" : "USD", rates: { GBP: 0.8 } }),
    }) });
    await expect(fx.getUsdRate("GBP")).rejects.toThrow("invalid USD base currency");
    expect(await fx.getUsdRate("GBP")).toBe(0.8);
    expect(await fx.getUsdRate("GBP")).toBe(0.8);
    expect(calls).toBe(2);
  });
});
