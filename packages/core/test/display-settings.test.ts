import { describe, expect, it } from "vitest";

import {
  BuildDisplayValue,
  GetUserSettings,
  SetDisplayCurrency,
} from "../src/application/loyalty/display-settings";
import { convertUsdCents } from "../src/domain/fx";
import { InvalidDisplayCurrencyError } from "../src/domain/errors";
import {
  HttpFxRateSource,
  StaticFxRateSource,
  type FxFetch,
} from "../src/infrastructure/fx/fx-rate-sources";
import { InMemoryUserSettingsRepository } from "./fakes";

import { asUserId } from "./ids";
const clock = { now: () => new Date("2026-07-09T12:00:00Z") };

describe("convertUsdCents", () => {
  it("converts to two decimals, zero decimals for JPY", () => {
    expect(convertUsdCents(204_044, "EUR", 0.92)).toBe(1877.2);
    expect(convertUsdCents(204_044, "JPY", 155)).toBe(316_268);
  });
  it("rounds exact decimal halves to target minor units", () => {
    expect(convertUsdCents(201, "AUD", 1.5)).toBe(3.02);
    expect(convertUsdCents(201, "EUR", 0.5)).toBe(1.01);
    expect(convertUsdCents(201, "JPY", 50)).toBe(101);
    expect(convertUsdCents(100, "EUR", 1.005)).toBe(1.01);
  });
  it("preserves signed rounding, zero and finite signed rates", () => {
    expect(convertUsdCents(-201, "AUD", 1.5)).toBe(-3.01);
    expect(convertUsdCents(-201, "JPY", 50)).toBe(-100);
    expect(convertUsdCents(201, "EUR", -0.5)).toBe(-1);
    expect(convertUsdCents(100, "EUR", 0)).toBe(0);
    expect(Object.is(convertUsdCents(-1, "EUR", 0.5), -0)).toBe(true);
    expect(Object.is(convertUsdCents(-0, "EUR", 1), -0)).toBe(true);
  });
  it("handles decimal exponent notation without intermediate overflow", () => {
    expect(convertUsdCents(1_000_000, "EUR", 1e-7)).toBe(0);
    expect(convertUsdCents(0, "EUR", 1e308)).toBe(0);
    expect(convertUsdCents(Number.MAX_SAFE_INTEGER, "JPY", 100)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("rejects unsafe inputs and unrepresentable converted values explicitly", () => {
    for (const cents of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5]) expect(() => convertUsdCents(cents, "EUR", 1)).toThrow(RangeError);
    for (const rate of [NaN, Infinity, -Infinity, 1e308]) expect(() => convertUsdCents(10_000, "EUR", rate)).toThrow(RangeError);
    expect(() => convertUsdCents(Number.MAX_SAFE_INTEGER, "EUR", 1)).toThrow(RangeError);
  });
});

describe("settings use cases", () => {
  it("defaults to USD when never saved, and round-trips a change", async () => {
    const repo = new InMemoryUserSettingsRepository();
    expect((await new GetUserSettings(repo).execute(asUserId("u"))).displayCurrency).toBe(
      "USD",
    );

    await new SetDisplayCurrency(repo, clock).execute(asUserId("u"), "EUR");
    expect((await new GetUserSettings(repo).execute(asUserId("u"))).displayCurrency).toBe(
      "EUR",
    );
  });

  it("rejects unsupported currencies", async () => {
    const repo = new InMemoryUserSettingsRepository();
    await expect(
      new SetDisplayCurrency(repo, clock).execute(asUserId("u"), "XYZ"),
    ).rejects.toBeInstanceOf(InvalidDisplayCurrencyError);
  });
});

describe("BuildDisplayValue", () => {
  it("returns null for USD users and converts for others", async () => {
    const repo = new InMemoryUserSettingsRepository();
    const build = new BuildDisplayValue(repo, new StaticFxRateSource());

    expect(await build.execute(asUserId("u"), 100_000)).toBeNull(); // default USD

    await new SetDisplayCurrency(repo, clock).execute(asUserId("u"), "GBP");
    const display = await build.execute(asUserId("u"), 100_000);
    expect(display).toEqual({ currency: "GBP", amount: 790, ratePerUsd: 0.79 });
  });

  it("degrades to null when the rate source fails", async () => {
    const repo = new InMemoryUserSettingsRepository();
    await new SetDisplayCurrency(repo, clock).execute(asUserId("u"), "EUR");
    const build = new BuildDisplayValue(repo, {
      getUsdRate: async () => {
        throw new Error("fx down");
      },
    });
    expect(await build.execute(asUserId("u"), 100_000)).toBeNull();
  });
  it("returns explicit unavailable for overflow rather than a JSON-null numeric amount", async () => {
    const repo = new InMemoryUserSettingsRepository();
    await new SetDisplayCurrency(repo, clock).execute(asUserId("u"), "AUD");
    const build = new BuildDisplayValue(repo, { getUsdRate: async () => 1e308 });
    expect(await build.execute(asUserId("u"), 10_000)).toBeNull();
    expect(JSON.stringify(await build.execute(asUserId("u"), 10_000))).toBe("null");
  });
  it("uses exact rounding at the display DTO boundary and rejects unsafe USD inputs", async () => {
    const repo = new InMemoryUserSettingsRepository();
    await new SetDisplayCurrency(repo, clock).execute(asUserId("u"), "AUD");
    const build = new BuildDisplayValue(repo, { getUsdRate: async () => 1.5 });
    expect(await build.execute(asUserId("u"), 201)).toEqual({ currency: "AUD", amount: 3.02, ratePerUsd: 1.5 });
    expect(await build.execute(asUserId("u"), Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});

describe("HttpFxRateSource", () => {
  function fxFetch(
    respond: () => { ok: boolean; status?: number; text: string },
  ): { fetchImpl: FxFetch; calls: string[] } {
    const calls: string[] = [];
    const fetchImpl: FxFetch = async (url) => {
      calls.push(url);
      const r = respond();
      return {
        ok: r.ok,
        status: r.status ?? 200,
        text: async () => r.text,
      };
    };
    return { fetchImpl, calls };
  }

  it("fetches and caches the rate", async () => {
    const { fetchImpl, calls } = fxFetch(() => ({
      ok: true,
      text: JSON.stringify({ rates: { EUR: 0.93 } }),
    }));
    const fx = new HttpFxRateSource({ baseUrl: "https://fx.test/v1/", fetchImpl });

    expect(await fx.getUsdRate("EUR")).toBe(0.93);
    expect(await fx.getUsdRate("EUR")).toBe(0.93); // cached
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("https://fx.test/v1/latest?base=USD&symbols=EUR");
  });

  it("throws on HTTP errors and invalid rates", async () => {
    const down = fxFetch(() => ({ ok: false, status: 503, text: "" }));
    await expect(
      new HttpFxRateSource({ baseUrl: "https://f", fetchImpl: down.fetchImpl }).getUsdRate("EUR"),
    ).rejects.toThrow(/503/);

    const bad = fxFetch(() => ({ ok: true, text: JSON.stringify({ rates: { EUR: -1 } }) }));
    await expect(
      new HttpFxRateSource({ baseUrl: "https://f", fetchImpl: bad.fetchImpl }).getUsdRate("EUR"),
    ).rejects.toThrow(/invalid rate/);
  });
});
