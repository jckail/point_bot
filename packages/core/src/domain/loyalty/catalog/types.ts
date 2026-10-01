/**
 * Catalog entry types. Kept dependency-free so every catalog file (and the
 * agent skill generator) can import them without cycles.
 */

/**
 * Every category of points-earning program PointUp tracks. Order here drives
 * display order in summaries and dashboards.
 */
export const PROVIDER_KINDS = [
  "airline",
  "hotel",
  "credit_card",
  "rail",
  "car_rental",
  "cruise",
  "rideshare",
  "dining",
  "shopping",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  airline: "Airline",
  hotel: "Hotel",
  credit_card: "Credit card",
  rail: "Rail",
  car_rental: "Car rental",
  cruise: "Cruise",
  rideshare: "Rideshare",
  dining: "Dining",
  shopping: "Shopping",
};

/** How much to trust an entry's editorial numbers (value, expiry policy). */
export const CATALOG_CONFIDENCE = ["high", "medium", "low"] as const;
export type CatalogConfidence = (typeof CATALOG_CONFIDENCE)[number];

/** Loyalty alliances / groupings used for routing and award search. */
export const ALLIANCES = ["star_alliance", "oneworld", "skyteam"] as const;
export type Alliance = (typeof ALLIANCES)[number];

/** Where and how an agent reads this program's balance (see domain/agent). */
export interface AgentSkillSeed {
  readonly startUrl: string;
  /** Hosts (exact or `.suffix`) the agent may read from. */
  readonly allowedHosts: readonly string[];
  readonly hint: string;
  readonly version?: number;
  /** ISO date a human last verified the URL/hint against the live site. */
  readonly verifiedAt?: string;
  readonly notes?: readonly string[];
  readonly maxPoints?: number;
}

export interface ProviderDefinition {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  /** Name of the provider's points/miles currency, e.g. "MileagePlus miles". */
  readonly pointsCurrency: string;
  /**
   * Editorial estimate of one point's redemption value in US cents, used to
   * approximate portfolio value. Not a market price; revisit periodically.
   */
  readonly estimatedCentsPerPoint: number;
  /**
   * Months of inactivity after which points expire. `null` means the program
   * does not expire balances for inactivity (or has no published policy).
   */
  readonly inactivityExpiryMonths: number | null;
  /** Trust in the editorial numbers above. Be honest: "low" is fine. */
  readonly confidence: CatalogConfidence;
  /** ISO date (YYYY-MM-DD) the entry was last reviewed by a human or agent. */
  readonly lastReviewed: string;
  /** Alternate names for search and the assistant ("AAdvantage", "AA"). */
  readonly aliases?: readonly string[];
  /** ISO 3166 alpha-2 home country/region, e.g. "US"; omit for global. */
  readonly region?: string;
  readonly alliance?: Alliance;
  /** Present when agents can read this program's balance from the web. */
  readonly agentSkill?: AgentSkillSeed;
}
