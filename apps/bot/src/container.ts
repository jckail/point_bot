import {
  buildDrizzleRepositories,
  buildLoyaltyModule,
  createDb,
  selectFx,
  selectGateway,
  selectLlm,
  selectScraper,
  selectVault,
} from "@pointup/core";

import type { BotEnv } from "./env";
import type { BotUseCases } from "./commands";

/**
 * The bot's composition root: env -> adapters, then the shared loyalty module.
 * The bot is read-only, so it exposes only the use cases it needs.
 */
export function createContainer(env: BotEnv): BotUseCases {
  const loyalty = buildLoyaltyModule({
    repos: buildDrizzleRepositories(createDb(env.DATABASE_URL)),
    gateway: selectGateway({}),
    vault: selectVault({}),
    fx: selectFx({}),
    scraper: selectScraper({}),
    llm: selectLlm(env),
  });

  return {
    listAccounts: loyalty.listLoyaltyAccounts,
    getValueAdvice: loyalty.getValueAdvice,
    chatWithAssistant: loyalty.chatWithAssistant,
  };
}
