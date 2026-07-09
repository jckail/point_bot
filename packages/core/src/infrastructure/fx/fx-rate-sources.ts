import type { DisplayCurrency, FxRateSource } from "../../domain/fx";

/** Minimal fetch shape so the adapter is unit-testable without a network. */
export type FxFetch = (
  url: string,
  init: { method: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const defaultFetch: FxFetch = (url, init) => fetch(url, init as RequestInit);

export interface HttpFxRateSourceConfig {
  /** e.g. https://api.frankfurter.dev/v1 — no API key required. */
  readonly baseUrl: string;
  readonly fetchImpl?: FxFetch;
  /** Rates barely move intraday; cache to avoid hammering the API. */
  readonly cacheTtlMs?: number;
}

/**
 * Frankfurter-style FX API adapter:
 *   GET {baseUrl}/latest?base=USD&symbols=EUR → { "rates": { "EUR": 0.92 } }
 * Responses are cached in-process (default 1h) since display conversion does
 * not need tick-level precision.
 */
export class HttpFxRateSource implements FxRateSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: FxFetch;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<
    DisplayCurrency,
    { rate: number; fetchedAt: number }
  >();

  constructor(config: HttpFxRateSourceConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? defaultFetch;
    this.cacheTtlMs = config.cacheTtlMs ?? 60 * 60 * 1000;
  }

  async getUsdRate(currency: DisplayCurrency): Promise<number> {
    const cached = this.cache.get(currency);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.rate;
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}/latest?base=USD&symbols=${currency}`,
      { method: "GET", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      throw new Error(`FX rate fetch failed (${response.status})`);
    }
    const payload = JSON.parse(await response.text()) as {
      rates?: Record<string, unknown>;
    };
    const rate = payload.rates?.[currency];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`FX API returned an invalid rate for ${currency}`);
    }
    this.cache.set(currency, { rate, fetchedAt: Date.now() });
    return rate;
  }
}

/**
 * Pinned rates for local development and tests — order-of-magnitude correct,
 * not live. Production should configure `HttpFxRateSource`.
 */
export class StaticFxRateSource implements FxRateSource {
  private static readonly RATES: Record<DisplayCurrency, number> = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    CAD: 1.36,
    AUD: 1.5,
    JPY: 155,
  };

  async getUsdRate(currency: DisplayCurrency): Promise<number> {
    return StaticFxRateSource.RATES[currency];
  }
}
