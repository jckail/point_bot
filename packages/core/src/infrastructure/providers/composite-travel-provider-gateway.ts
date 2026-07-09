import type { LoyaltyAccount } from "../../domain/loyalty/loyalty-account";
import type {
  ProviderBalance,
  ProviderCredential,
  TravelProviderGateway,
} from "../../application/ports";

/**
 * Routes balance fetches to the first registered gateway that supports the
 * provider. Adding a real airline/hotel integration means writing one new
 * adapter and registering it here - no existing code changes (open/closed).
 */
export class CompositeTravelProviderGateway implements TravelProviderGateway {
  constructor(private readonly gateways: readonly TravelProviderGateway[]) {}

  supports(providerId: string): boolean {
    return this.gateways.some((gateway) => gateway.supports(providerId));
  }

  fetchBalance(
    account: LoyaltyAccount,
    credential: ProviderCredential | null,
  ): Promise<ProviderBalance> {
    const gateway = this.gateways.find((candidate) =>
      candidate.supports(account.providerId),
    );
    if (!gateway) {
      throw new Error(
        `No gateway registered for provider "${account.providerId}"`,
      );
    }
    return gateway.fetchBalance(account, credential);
  }
}
