import type { LoyaltyAccount } from "../../domain/loyalty/loyalty-account";
import { isSupportedProvider } from "../../domain/loyalty/provider";
import type {
  ProviderBalance,
  TravelProviderGateway,
} from "../../application/ports";

/**
 * Development stand-in for real airline/hotel integrations. Returns a
 * deterministic pseudo-random balance derived from the account so the UI is
 * stable across syncs. Replace per provider with real adapters (see
 * docs/integrations.md) and register them ahead of this one in the composite
 * gateway.
 */
export class SimulatedTravelProviderGateway implements TravelProviderGateway {
  supports(providerId: string): boolean {
    return isSupportedProvider(providerId);
  }

  async fetchBalance(account: LoyaltyAccount): Promise<ProviderBalance> {
    const seed = `${account.providerId}:${account.membershipNumber}`;
    let hash = 0;
    for (const char of seed) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return { points: hash % 250_000 };
  }
}
