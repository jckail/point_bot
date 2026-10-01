import { ProviderNotSupportedError } from "../errors";
import { AIRLINE_PROVIDERS } from "./catalog/airlines";
import { CARD_PROVIDERS } from "./catalog/cards";
import { DINING_PROVIDERS } from "./catalog/dining";
import { HOTEL_PROVIDERS } from "./catalog/hotels";
import { OTHER_PROVIDERS } from "./catalog/other";
import { TRAVEL_PROVIDERS } from "./catalog/travel";
import type { ProviderDefinition } from "./catalog/types";

/**
 * The catalog of loyalty providers PointUp understands. This is domain
 * knowledge (no IO), so it lives in the domain layer. Adding a provider here
 * is the only required change for the rest of the system to recognize it
 * (open/closed principle); a bespoke gateway adapter in the infrastructure
 * layer is optional and can be registered later.
 */

export {
  ALLIANCES,
  CATALOG_CONFIDENCE,
  PROVIDER_KINDS,
  PROVIDER_KIND_LABELS,
  type Alliance,
  type AgentSkillSeed,
  type CatalogConfidence,
  type ProviderDefinition,
  type ProviderKind,
} from "./catalog/types";

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

/** The full catalog, assembled from per-kind files (extend those, not this). */
export const PROVIDER_CATALOG: readonly ProviderDefinition[] = [
  ...AIRLINE_PROVIDERS,
  ...HOTEL_PROVIDERS,
  ...CARD_PROVIDERS,
  ...TRAVEL_PROVIDERS,
  ...DINING_PROVIDERS,
  ...OTHER_PROVIDERS,
];

/** id -> provider, built once (first definition wins, like `Array.find`). */
const PROVIDER_BY_ID: ReadonlyMap<string, ProviderDefinition> = (() => {
  const index = new Map<string, ProviderDefinition>();
  for (const provider of PROVIDER_CATALOG) {
    if (!index.has(provider.id)) index.set(provider.id, provider);
  }
  return index;
})();

export function findProvider(
  providerId: string,
): ProviderDefinition | undefined {
  return PROVIDER_BY_ID.get(providerId);
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
