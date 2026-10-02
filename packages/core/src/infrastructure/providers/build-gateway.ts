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
  /** Explicit demo-only fallback; unconfigured real hosts remain unavailable. */
  readonly allowSimulation?: boolean;
}

/**
 * Composition helper shared by every host (web, worker) so they build the same
 * provider gateway: configured real adapters first. Simulation is appended only
 * for an explicitly enabled demo context, never as an implicit real-user sync.
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
        ...(aggregator.fetchImpl ? { fetchImpl: aggregator.fetchImpl } : {}),
        ...(aggregator.supportedProviderIds
          ? { supportedProviderIds: aggregator.supportedProviderIds }
          : {}),
      }),
    );
  }

  if (options.allowSimulation === true) gateways.push(new SimulatedTravelProviderGateway());
  return new CompositeTravelProviderGateway(gateways);
}
