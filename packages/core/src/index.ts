// Domain
export * from "./domain/errors";
export * from "./domain/loyalty/provider";
export * from "./domain/loyalty/loyalty-account";
export * from "./domain/loyalty/balance-snapshot";
export * from "./domain/loyalty/repositories";
export * from "./domain/loyalty/trip-goal";
export * from "./domain/loyalty/portfolio-share";
export * from "./domain/loyalty/custom-valuation";
export * from "./domain/loyalty/award-watch";
export * from "./domain/fx";
export * from "./domain/loyalty/user-settings";

// Dev auth safety rules (shared by web + bootstrap)
export * from "./dev-auth";

// Agent bounded context
export * from "./domain/agent/access-token";
export * from "./domain/agent/consent";
export * from "./domain/agent/observation";
export * from "./domain/agent/skill";
export * from "./application/agent/access-tokens";
export * from "./application/agent/consents";
export * from "./application/agent/list-skills";
export * from "./application/agent/submit-observation";
export * from "./infrastructure/repositories/drizzle-agent-repositories";

// Domain events + transactional outbox
export * from "./domain/events";
export * from "./application/events";
export * from "./infrastructure/outbox/drizzle-outbox";

// Application
export * from "./application/ports";
export * from "./application/cache";
export * from "./application/loyalty/read-models";
export * from "./application/loyalty/list-providers";
export * from "./application/loyalty/link-loyalty-account";
export * from "./application/loyalty/list-loyalty-accounts";
export * from "./application/loyalty/get-loyalty-account";
export * from "./application/loyalty/update-loyalty-account";
export * from "./application/loyalty/custom-valuations";
export * from "./application/loyalty/award-watches";
export * from "./application/loyalty/display-settings";
export * from "./application/loyalty/bulk-update-membership";
export * from "./application/loyalty/restore-loyalty-account";
export * from "./application/loyalty/get-balance-history";
export * from "./application/loyalty/record-manual-balance";
export * from "./application/loyalty/get-portfolio-summary";
export * from "./application/loyalty/build-portfolio-digest";
export * from "./application/loyalty/derive-alerts";
export * from "./application/loyalty/export-portfolio";
export * from "./application/loyalty/import-portfolio";
export * from "./application/loyalty/balance-trend";
export * from "./application/loyalty/list-activity";
export * from "./application/loyalty/list-expiring-accounts";
export * from "./application/loyalty/build-expiration-calendar";
export * from "./application/loyalty/create-trip-goal";
export * from "./application/loyalty/list-trip-goals";
export * from "./application/loyalty/update-trip-goal";
export * from "./application/loyalty/seed-demo-portfolio";
export * from "./application/loyalty/portfolio-share";
export * from "./application/loyalty/assistant";
export * from "./application/loyalty/ingest-deal-page";
export * from "./application/loyalty/transfer-bonuses";
export * from "./application/loyalty/plan-redemption";
export * from "./application/loyalty/sync-loyalty-account";
export * from "./application/loyalty/sync-all-loyalty-accounts";

// Domain
export * from "./domain/loyalty/activity";
export * from "./domain/loyalty/transfer-partners";
export * from "./domain/loyalty/transfer-ranking";
export * from "./domain/loyalty/deals";
export * from "./domain/loyalty/transfer-bonus";
export * from "./domain/loyalty/catalog/sweet-spots";
export * from "./domain/loyalty/award-availability";
export * from "./domain/loyalty/optimizer";
export { projectExpiryDate } from "./domain/loyalty/provider";
export { refreshExpiryFromActivity } from "./domain/loyalty/loyalty-account";

// Infrastructure
export * from "./infrastructure/db/client";
export * as dbSchema from "./infrastructure/db/schema";
export * from "./infrastructure/repositories/drizzle-loyalty-account-repository";
export * from "./infrastructure/repositories/drizzle-custom-valuation-repository";
export * from "./infrastructure/repositories/drizzle-award-watch-repository";
export * from "./infrastructure/repositories/drizzle-transfer-bonus-repository";
export * from "./infrastructure/award-search/award-availability-sources";
export * from "./infrastructure/repositories/drizzle-user-settings-repository";
export * from "./infrastructure/fx/fx-rate-sources";
export * from "./infrastructure/providers/composite-travel-provider-gateway";
export * from "./infrastructure/providers/simulated-travel-provider-gateway";
export * from "./infrastructure/providers/http-aggregator-travel-provider-gateway";
export * from "./infrastructure/providers/build-gateway";
export * from "./infrastructure/vault/one-password-connect-vault";
export * from "./infrastructure/vault/null-credential-vault";
export * from "./infrastructure/llm/openai-compatible-assistant";
export * from "./infrastructure/llm/bedrock-assistant";
export * from "./infrastructure/notify/webhook-notifiers";
export * from "./infrastructure/scraper/firecrawl-page-scraper";
export * from "./application/rate-limit";

// Composition (per-context wiring shared by every host)
export * from "./composition/repositories";
export * from "./composition/loyalty-module";
export * from "./composition/agent-module";
export * from "./composition/adapters";
export * from "./observability";
