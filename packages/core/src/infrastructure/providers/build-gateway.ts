import type { TravelProviderGateway } from "../../application/ports";
import { CompositeTravelProviderGateway } from "./composite-travel-provider-gateway";
import {
  HttpAggregatorTravelProviderGateway,
  type HttpAggregatorConfig,
} from "./http-aggregator-travel-provider-gateway";
import { SimulatedTravelProviderGateway } from "./simulated-travel-provider-gateway";

export interface BuildGatewayOptions {
  /** Explicit demo/development opt-in. Never fabricate balances by default. */
  readonly allowSimulation?: boolean;
  /** When set (baseUrl + apiKey), a real aggregator gateway is added first. */
  readonly aggregator?: Partial<HttpAggregatorConfig>;
}

/**
 * Composition helper shared by every host (web, worker) so they build the same
 * provider gateway: real aggregator adapters when configured. Simulation
 * requires explicit opt-in; missing integrations surface as unsupported.
 */
export function buildTravelProviderGateway(
  options: BuildGatewayOptions = {},
): CompositeTravelProviderGateway {
  const gateways: TravelProviderGateway[] = [];

  const aggregator = options.aggregator;
  if (aggregator?.baseUrl && aggregator.apiKey) {
    gateways.push(
      new HttpAggregatorTravelProviderGateway({
        baseUrl: aggregator.baseUrl,
        apiKey: aggregator.apiKey,
        ...(aggregator.supportedProviderIds
          ? { supportedProviderIds: aggregator.supportedProviderIds }
          : {}),
      }),
    );
  }

  if (options.allowSimulation) {
    gateways.push(new SimulatedTravelProviderGateway());
  }
  return new CompositeTravelProviderGateway(gateways);
}
