import {
  BedrockAssistant,
  ChatWithAssistant,
  createDb,
  DrizzleBalanceSnapshotRepository,
  DrizzleLoyaltyAccountRepository,
  DrizzleTripGoalRepository,
  GetValueAdvice,
  HeuristicAssistant,
  ListLoyaltyAccounts,
  ListTripGoals,
  OpenAiCompatibleAssistant,
  type LlmAssistant,
} from "@pointup/core";

import type { BotEnv } from "./env";
import type { BotUseCases } from "./commands";

/** Assistant selection mirrors the web composition root. */
function buildLlm(env: BotEnv): LlmAssistant {
  if (env.LLM_PROVIDER === "bedrock" && env.BEDROCK_MODEL_ID) {
    return new BedrockAssistant({
      modelId: env.BEDROCK_MODEL_ID,
      region: env.AWS_REGION,
    });
  }
  if (env.LLM_API_KEY) {
    return new OpenAiCompatibleAssistant({
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
      baseUrl: env.LLM_BASE_URL,
    });
  }
  return new HeuristicAssistant();
}

/** The bot's composition root — read-only use cases over the shared core. */
export function createContainer(env: BotEnv): BotUseCases {
  const db = createDb(env.DATABASE_URL);
  const accounts = new DrizzleLoyaltyAccountRepository(db);
  const balances = new DrizzleBalanceSnapshotRepository(db);
  const tripGoals = new DrizzleTripGoalRepository(db);

  const listAccounts = new ListLoyaltyAccounts(accounts, balances);
  const listGoals = new ListTripGoals(tripGoals, balances);

  return {
    listAccounts,
    getValueAdvice: new GetValueAdvice(listAccounts),
    chatWithAssistant: new ChatWithAssistant(
      listAccounts,
      listGoals,
      buildLlm(env),
    ),
  };
}
