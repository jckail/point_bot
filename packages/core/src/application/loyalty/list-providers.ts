import { PROVIDER_CATALOG } from "../../domain/loyalty/provider";
import type { ProviderReadModel } from "./read-models";

/** Returns the catalog of providers users can link accounts for. */
export class ListProviders {
  execute(): ProviderReadModel[] {
    return PROVIDER_CATALOG.map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      displayName: provider.displayName,
      pointsCurrency: provider.pointsCurrency,
      estimatedCentsPerPoint: provider.estimatedCentsPerPoint,
      inactivityExpiryMonths: provider.inactivityExpiryMonths,
    }));
  }
}
