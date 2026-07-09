import { ProviderNotSupportedError } from "../errors";

/**
 * The catalog of loyalty providers PointUp understands. This is domain
 * knowledge (no IO), so it lives in the domain layer. Adding a provider here
 * is the only required change for the rest of the system to recognize it
 * (open/closed principle); a bespoke gateway adapter in the infrastructure
 * layer is optional and can be registered later.
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
  "shopping",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  airline: "Airline",
  hotel: "Hotel",
  credit_card: "Credit card",
  rail: "Rail",
  shopping: "Shopping",
};

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
}

/** Approximate USD value (in whole cents) of a points balance. */
export function estimateValueCents(
  provider: ProviderDefinition,
  points: number,
): number {
  return Math.round(points * provider.estimatedCentsPerPoint);
}

/** Projected expiry date from a reference moment, or null if the program never expires. */
export function projectExpiryDate(
  provider: ProviderDefinition,
  from: Date,
): Date | null {
  if (provider.inactivityExpiryMonths === null) return null;
  const expires = new Date(from.getTime());
  expires.setUTCMonth(expires.getUTCMonth() + provider.inactivityExpiryMonths);
  return expires;
}

export const PROVIDER_CATALOG: readonly ProviderDefinition[] = [
  {
    id: "united",
    kind: "airline",
    displayName: "United Airlines",
    pointsCurrency: "MileagePlus miles",
    estimatedCentsPerPoint: 1.2,
    inactivityExpiryMonths: 18,
  },
  {
    id: "delta",
    kind: "airline",
    displayName: "Delta Air Lines",
    pointsCurrency: "SkyMiles",
    estimatedCentsPerPoint: 1.1,
    inactivityExpiryMonths: null,
  },
  {
    id: "american",
    kind: "airline",
    displayName: "American Airlines",
    pointsCurrency: "AAdvantage miles",
    estimatedCentsPerPoint: 1.4,
    inactivityExpiryMonths: 24,
  },
  {
    id: "marriott",
    kind: "hotel",
    displayName: "Marriott Bonvoy",
    pointsCurrency: "Bonvoy points",
    estimatedCentsPerPoint: 0.7,
    inactivityExpiryMonths: 24,
  },
  {
    id: "hilton",
    kind: "hotel",
    displayName: "Hilton Honors",
    pointsCurrency: "Honors points",
    estimatedCentsPerPoint: 0.5,
    inactivityExpiryMonths: null,
  },
  {
    id: "hyatt",
    kind: "hotel",
    displayName: "World of Hyatt",
    pointsCurrency: "World of Hyatt points",
    estimatedCentsPerPoint: 1.7,
    inactivityExpiryMonths: 24,
  },
  {
    id: "chase-ultimate-rewards",
    kind: "credit_card",
    displayName: "Chase Ultimate Rewards",
    pointsCurrency: "Ultimate Rewards points",
    estimatedCentsPerPoint: 1.6,
    inactivityExpiryMonths: null,
  },
  {
    id: "amex-membership-rewards",
    kind: "credit_card",
    displayName: "Amex Membership Rewards",
    pointsCurrency: "Membership Rewards points",
    estimatedCentsPerPoint: 1.6,
    inactivityExpiryMonths: null,
  },
  {
    id: "capital-one-miles",
    kind: "credit_card",
    displayName: "Capital One Rewards",
    pointsCurrency: "Capital One miles",
    estimatedCentsPerPoint: 1.5,
    inactivityExpiryMonths: null,
  },
  {
    id: "citi-thankyou",
    kind: "credit_card",
    displayName: "Citi ThankYou Rewards",
    pointsCurrency: "ThankYou Points",
    estimatedCentsPerPoint: 1.5,
    inactivityExpiryMonths: null,
  },
  {
    id: "bilt",
    kind: "credit_card",
    displayName: "Bilt Rewards",
    pointsCurrency: "Bilt Points",
    estimatedCentsPerPoint: 1.8,
    inactivityExpiryMonths: null,
  },
  {
    id: "amtrak",
    kind: "rail",
    displayName: "Amtrak Guest Rewards",
    pointsCurrency: "Guest Rewards points",
    estimatedCentsPerPoint: 2.5,
    inactivityExpiryMonths: 36,
  },
  {
    id: "rakuten",
    kind: "shopping",
    displayName: "Rakuten Rewards",
    pointsCurrency: "Rakuten points",
    estimatedCentsPerPoint: 1.0,
    inactivityExpiryMonths: null,
  },
];

export function findProvider(
  providerId: string,
): ProviderDefinition | undefined {
  return PROVIDER_CATALOG.find((provider) => provider.id === providerId);
}

/**
 * For call sites reading data that passed the factory invariants (persisted
 * accounts reference cataloged providers). Throwing beats a non-null
 * assertion: if a provider is ever removed from the catalog while accounts
 * still reference it, the failure is explicit and coded.
 */
export function getProviderOrThrow(providerId: string): ProviderDefinition {
  const provider = findProvider(providerId);
  if (!provider) throw new ProviderNotSupportedError(providerId);
  return provider;
}

export function isSupportedProvider(providerId: string): boolean {
  return findProvider(providerId) !== undefined;
}
