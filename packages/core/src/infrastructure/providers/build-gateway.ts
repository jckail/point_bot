import type { TravelProviderGateway } from "../../application/ports";
import { CompositeTravelProviderGateway } from "./composite-travel-provider-gateway";
import {
  HttpAggregatorTravelProviderGateway,
  type HttpAggregatorConfig,
} from "./http-aggregator-travel-provider-gateway";
import { SimulatedTravelProviderGateway } from "./simulated-travel-provider-gateway";

export interface BuildGatewayOptions {
  /** When set (baseUrl + apiKey), a real aggregator gateway is added first. */
  readonly aggregator?: Partial<HttpAggregatorConfig>;
}

/**
 * Composition helper shared by every host (web, worker) so they build the same
 * provider gateway: the real aggregator adapter first (when configured), then
 * the simulated gateway as the fallback for everything else.
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

  gateways.push(new SimulatedTravelProviderGateway());
  return new CompositeTravelProviderGateway(gateways);
}
