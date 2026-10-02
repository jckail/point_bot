import { beforeEach, expect, it, vi } from "vitest";
import type { GatewayConfig } from "@pointup/core";

const config = vi.hoisted((): { env: GatewayConfig } => ({ env: { AUTH_PROVIDER: "clerk" } }));
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => config);
import { getProviderSyncOptions } from "./provider-sync";

beforeEach(() => { config.env.AUTH_PROVIDER = "clerk"; config.env.AGGREGATOR_API_URL = undefined; config.env.AGGREGATOR_API_KEY = undefined; config.env.aggregatorSupportedProviderIds = undefined; });

it("offers no bulk sync for real accounts without a configured API", () => {
  expect(getProviderSyncOptions(["united", "hyatt"])).toEqual({ modes: { united: "unavailable", hyatt: "unavailable" }, bulkLabel: null });
  config.env.AGGREGATOR_API_URL = "https://aggregator.example";
  expect(getProviderSyncOptions(["united"]).bulkLabel).toBeNull();
});
it("labels explicit demo mode and keeps unknown programs unavailable", () => {
  config.env.AUTH_PROVIDER = "dev";
  expect(getProviderSyncOptions(["united", "unknown"])).toEqual({ modes: { united: "demo", unknown: "unavailable" }, bulkLabel: "Demo sync all" });
  expect(getProviderSyncOptions([])).toEqual({ modes: {}, bulkLabel: null });
});
it("returns configured API capability without sending its secrets or endpoint to the client", () => {
  config.env.AUTH_PROVIDER = "dev";
  config.env.AGGREGATOR_API_URL = "https://private-aggregator.example";
  config.env.AGGREGATOR_API_KEY = "private-api-key";
  const result = getProviderSyncOptions(["united", "hyatt"]);
  expect(result).toEqual({ modes: { united: "api", hyatt: "api" }, bulkLabel: "Sync supported balances" });
  expect(JSON.stringify(result)).not.toContain("private");
  expect(JSON.stringify(result)).not.toContain("AGGREGATOR");
});
it("labels only supported balances for a mixed API/unavailable portfolio", () => {
  config.env.AGGREGATOR_API_URL = "https://aggregator.example";
  config.env.AGGREGATOR_API_KEY = "private-api-key";
  config.env.aggregatorSupportedProviderIds = ["united"];
  expect(getProviderSyncOptions(["united", "hyatt"])).toEqual({ modes: { united: "api", hyatt: "unavailable" }, bulkLabel: "Sync supported balances" });
});
