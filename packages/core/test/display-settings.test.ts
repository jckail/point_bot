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

const clock = { now: () => new Date("2026-07-09T12:00:00Z") };

describe("convertUsdCents", () => {
  it("converts to two decimals, zero decimals for JPY", () => {
    expect(convertUsdCents(204_044, "EUR", 0.92)).toBe(1877.2);
    expect(convertUsdCents(204_044, "JPY", 155)).toBe(316_268);
  });
});

describe("settings use cases", () => {
  it("defaults to USD when never saved, and round-trips a change", async () => {
    const repo = new InMemoryUserSettingsRepository();
    expect((await new GetUserSettings(repo).execute("u")).displayCurrency).toBe(
      "USD",
    );

    await new SetDisplayCurrency(repo, clock).execute("u", "EUR");
    expect((await new GetUserSettings(repo).execute("u")).displayCurrency).toBe(
      "EUR",
    );
  });

  it("rejects unsupported currencies", async () => {
    const repo = new InMemoryUserSettingsRepository();
    await expect(
      new SetDisplayCurrency(repo, clock).execute("u", "XYZ"),
    ).rejects.toBeInstanceOf(InvalidDisplayCurrencyError);
  });
});

describe("BuildDisplayValue", () => {
  it("returns null for USD users and converts for others", async () => {
    const repo = new InMemoryUserSettingsRepository();
    const build = new BuildDisplayValue(repo, new StaticFxRateSource());

    expect(await build.execute("u", 100_000)).toBeNull(); // default USD

    await new SetDisplayCurrency(repo, clock).execute("u", "GBP");
    const display = await build.execute("u", 100_000);
    expect(display).toEqual({ currency: "GBP", amount: 790, ratePerUsd: 0.79 });
  });

  it("degrades to null when the rate source fails", async () => {
    const repo = new InMemoryUserSettingsRepository();
    await new SetDisplayCurrency(repo, clock).execute("u", "EUR");
    const build = new BuildDisplayValue(repo, {
      getUsdRate: async () => {
        throw new Error("fx down");
      },
    });
    expect(await build.execute("u", 100_000)).toBeNull();
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
