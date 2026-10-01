import type {
  AwardAvailabilitySource,
  CredentialVault,
  LlmAssistant,
  PageScraper,
} from "../application/ports";
import type { FxRateSource } from "../domain/fx";
import {
  StaticFxRateSource,
  HttpFxRateSource,
} from "../infrastructure/fx/fx-rate-sources";
import {
  HttpAwardAvailabilitySource,
  StubAwardAvailabilitySource,
} from "../infrastructure/award-search/award-availability-sources";
import { BedrockAssistant } from "../infrastructure/llm/bedrock-assistant";
import {
  HeuristicAssistant,
  OpenAiCompatibleAssistant,
} from "../infrastructure/llm/openai-compatible-assistant";
import { buildTravelProviderGateway } from "../infrastructure/providers/build-gateway";
import {
  FirecrawlPageScraper,
  StubPageScraper,
} from "../infrastructure/scraper/firecrawl-page-scraper";
import { NullCredentialVault } from "../infrastructure/vault/null-credential-vault";
import { OnePasswordConnectVault } from "../infrastructure/vault/one-password-connect-vault";

/**
 * Env-agnostic adapter selection. Hosts map their own validated environment
 * onto these plain option objects so the selection rules live in one place.
 */

export interface VaultConfig {
  OP_CONNECT_HOST?: string;
  OP_CONNECT_TOKEN?: string;
}

export function selectVault(config: VaultConfig): CredentialVault {
  if (config.OP_CONNECT_HOST && config.OP_CONNECT_TOKEN) {
    return new OnePasswordConnectVault({
      baseUrl: config.OP_CONNECT_HOST,
      token: config.OP_CONNECT_TOKEN,
    });
  }
  return new NullCredentialVault();
}

export const LLM_PROVIDERS = ["bedrock", "openai"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export interface LlmConfig {
  LLM_PROVIDER?: LlmProvider | undefined;
  BEDROCK_MODEL_ID?: string;
  AWS_REGION?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
}

export function selectLlm(config: LlmConfig): LlmAssistant {
  // Production (AWS): Claude on Bedrock via the task role, no API keys.
  if (config.LLM_PROVIDER === "bedrock" && config.BEDROCK_MODEL_ID) {
    return new BedrockAssistant({
      modelId: config.BEDROCK_MODEL_ID,
      region: config.AWS_REGION,
    });
  }
  // Local/dev: any OpenAI-compatible endpoint if a key is present.
  if (config.LLM_API_KEY) {
    return new OpenAiCompatibleAssistant({
      apiKey: config.LLM_API_KEY,
      model: config.LLM_MODEL,
      baseUrl: config.LLM_BASE_URL,
    });
  }
  // Fallback: deterministic heuristic assistant (offline demos, tests).
  return new HeuristicAssistant();
}

export interface ScraperConfig {
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_BASE_URL?: string;
}

export function selectScraper(config: ScraperConfig): PageScraper {
  if (config.FIRECRAWL_API_KEY) {
    return new FirecrawlPageScraper({
      apiKey: config.FIRECRAWL_API_KEY,
      baseUrl: config.FIRECRAWL_BASE_URL,
    });
  }
  return new StubPageScraper();
}

export interface FxConfig {
  FX_API_URL?: string;
}

export function selectFx(config: FxConfig): FxRateSource {
  return config.FX_API_URL
    ? new HttpFxRateSource({ baseUrl: config.FX_API_URL })
    : new StaticFxRateSource();
}

export interface GatewayConfig {
  AGGREGATOR_API_URL?: string;
  AGGREGATOR_API_KEY?: string;
}

export function selectGateway(config: GatewayConfig) {
  return buildTravelProviderGateway({
    aggregator:
      config.AGGREGATOR_API_URL && config.AGGREGATOR_API_KEY
        ? {
            baseUrl: config.AGGREGATOR_API_URL,
            apiKey: config.AGGREGATOR_API_KEY,
          }
        : undefined,
  });
}

export interface AwardSearchConfig {
  AWARD_SEARCH_API_URL?: string;
  AWARD_SEARCH_API_KEY?: string;
}

/** Real award search only when both URL and key are set; else the honest stub. */
export function selectAwardAvailability(
  config: AwardSearchConfig,
): AwardAvailabilitySource {
  return config.AWARD_SEARCH_API_URL && config.AWARD_SEARCH_API_KEY
    ? new HttpAwardAvailabilitySource({
        baseUrl: config.AWARD_SEARCH_API_URL,
        apiKey: config.AWARD_SEARCH_API_KEY,
      })
    : new StubAwardAvailabilitySource();
}
