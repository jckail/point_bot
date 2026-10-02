import { InvalidDisplayCurrencyError } from "./errors";
import { exactDecimalRatio } from "./shared/point-math";
import { isOneOf } from "./shared/enum";

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
  return isOneOf(SUPPORTED_DISPLAY_CURRENCIES, value);
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
  if (!Number.isSafeInteger(usdCents)) throw new RangeError("USD cents must be a safe integer.");
  const rate = exactDecimalRatio(ratePerUsd);
  const scale = currency === "JPY" ? 1 : 100;
  const numerator = BigInt(usdCents) * rate.numerator;
  const denominator = rate.denominator * (currency === "JPY" ? 100n : 1n);
  let minorUnits = numerator / denominator;
  const remainder = numerator % denominator;
  // Preserve Math.round's signed policy: exact halves round toward +Infinity.
  if (remainder * 2n >= denominator) minorUnits += 1n;
  else if (-remainder * 2n > denominator) minorUnits -= 1n;
  const bound = BigInt(Number.MAX_SAFE_INTEGER);
  if (minorUnits < -bound || minorUnits > bound) throw new RangeError("Converted display amount is unavailable.");
  const amount = Number(minorUnits) / scale;
  // At large magnitudes a number may lose a target minor unit even though its
  // integer minor-unit total is safe. Do not publish a different decimal value.
  const displayed = exactDecimalRatio(amount);
  if (displayed.numerator * BigInt(scale) !== minorUnits * displayed.denominator) {
    throw new RangeError("Converted display amount is unavailable.");
  }
  const negative = (usdCents < 0 || Object.is(usdCents, -0)) !== (ratePerUsd < 0 || Object.is(ratePerUsd, -0));
  return minorUnits === 0n && negative ? -0 : amount;
}
