import { InvalidBalanceError, InvalidValuationError } from "../errors";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function exactPoints(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new InvalidBalanceError();
  return BigInt(value);
}

export function safePoints(value: bigint): number {
  if (value < 0n || value > MAX_SAFE) throw new InvalidBalanceError();
  return Number(value);
}

/** Exact intermediates; number DTOs deliberately reject an unrepresentable total. */
export function checkedPointSum(values: Iterable<number>): number {
  let total = 0n;
  for (const value of values) total += exactPoints(value);
  return safePoints(total);
}

/** Floor once, after the exact multiplication (never after a rounded product). */
export function checkedPointRatio(points: number, numerator: number, denominator: number): number {
  const den = exactPoints(denominator);
  if (den === 0n) throw new InvalidBalanceError();
  return safePoints(exactPoints(points) * exactPoints(numerator) / den);
}

/**
 * Interpret the published decimal number exactly as written by Number.toString.
 * This preserves editorial precision and does not quantize rates to milli-cents.
 */
export function estimateValueCents(points: number, centsPerPoint: number): number {
  if (!Number.isFinite(centsPerPoint) || centsPerPoint <= 0) throw new InvalidValuationError();
  const [mantissa = "", exponentText = "0"] = centsPerPoint.toString().toLowerCase().split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const exponent = Number(exponentText) - fraction.length;
  let numerator = BigInt(whole + fraction);
  let denominator = 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator = 10n ** BigInt(-exponent);
  const product = exactPoints(points) * numerator;
  // Nonnegative Math.round semantics: ties round upward, with exact intermediates.
  return safePoints((2n * product + denominator) / (2n * denominator));
}
