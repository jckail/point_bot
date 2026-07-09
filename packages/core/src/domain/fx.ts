import { InvalidDisplayCurrencyError } from "./errors";

/**
 * Foreign-exchange support for displaying portfolio value in the user's
 * currency. Valuations stay **USD-denominated internally** (editorial and
 * custom cents-per-point are US cents); conversion happens only at the
 * display edge, so no stored data changes with the exchange rate.
 */

export const SUPPORTED_DISPLAY_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
] as const;

export type DisplayCurrency = (typeof SUPPORTED_DISPLAY_CURRENCIES)[number];

export function isSupportedDisplayCurrency(
  value: string,
): value is DisplayCurrency {
  return (SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes(value);
}

export function assertSupportedDisplayCurrency(
  value: string,
): DisplayCurrency {
  if (!isSupportedDisplayCurrency(value)) {
    throw new InvalidDisplayCurrencyError(value);
  }
  return value;
}

/**
 * Rate source port: units of `currency` per 1 USD (e.g. EUR ≈ 0.92).
 * Implementations: an HTTP FX API, or the static dev fallback.
 */
export interface FxRateSource {
  getUsdRate(currency: DisplayCurrency): Promise<number>;
}

/**
 * Convert whole US cents to a decimal amount in the target currency.
 * Two decimal places for all supported currencies except JPY (zero-decimal).
 */
export function convertUsdCents(
  usdCents: number,
  currency: DisplayCurrency,
  ratePerUsd: number,
): number {
  const amount = (usdCents / 100) * ratePerUsd;
  return currency === "JPY" ? Math.round(amount) : Math.round(amount * 100) / 100;
}
