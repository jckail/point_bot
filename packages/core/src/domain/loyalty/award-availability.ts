/**
 * Award availability value types (data only; the port lives in
 * application/ports.ts). Availability is only ever reported when a configured
 * source actually returned it.
 */

export const AWARD_CABINS = [
  "economy",
  "premium_economy",
  "business",
  "first",
] as const;
export type AwardCabin = (typeof AWARD_CABINS)[number];

export interface AwardSearchQuery {
  /** IATA airport/city code, upper case. */
  readonly origin: string;
  readonly destination: string;
  /** Inclusive date window, YYYY-MM-DD. */
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly cabin: AwardCabin;
}

export interface AwardOption {
  /** Catalog program id whose points price this option. */
  readonly programId: string;
  /** Operating/marketing carrier code when known. */
  readonly carrier: string | null;
  readonly date: string;
  readonly cabin: AwardCabin;
  readonly pointsCost: number;
  readonly taxesCents: number | null;
  readonly seats: number | null;
}

export const AWARD_SEARCH_STATUSES = ["ok", "not_configured", "error"] as const;
export type AwardSearchStatus = (typeof AWARD_SEARCH_STATUSES)[number];

export interface AwardSearchResult {
  readonly status: AwardSearchStatus;
  readonly options: readonly AwardOption[];
  readonly checkedAt: Date;
  readonly message: string | null;
}

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates and normalizes a query; returns an error message or the query. */
export function normalizeAwardQuery(
  raw: AwardSearchQuery,
): { ok: true; query: AwardSearchQuery } | { ok: false; reason: string } {
  const origin = raw.origin.trim().toUpperCase();
  const destination = raw.destination.trim().toUpperCase();
  if (!IATA.test(origin) || !IATA.test(destination)) {
    return { ok: false, reason: "origin and destination must be 3-letter IATA codes" };
  }
  if (!DATE.test(raw.dateFrom) || !DATE.test(raw.dateTo) || raw.dateTo < raw.dateFrom) {
    return { ok: false, reason: "dateFrom/dateTo must be YYYY-MM-DD with dateTo >= dateFrom" };
  }
  if (!(AWARD_CABINS as readonly string[]).includes(raw.cabin)) {
    return { ok: false, reason: "unknown cabin" };
  }
  return { ok: true, query: { ...raw, origin, destination } };
}
