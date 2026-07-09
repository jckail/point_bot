import {
  computePortfolioSummary,
  type LoyaltyAccountReadModel,
  type ValueAdviceReadModel,
} from "@pointup/core";

import {
  formatExpiring,
  formatPortfolio,
  formatValueAdvice,
  TRANSFER_DISCLAIMER,
} from "./format";

/**
 * The use cases the bot needs, as structural interfaces so command handling
 * can be unit-tested with plain fakes (no DB, no LLM).
 */
export interface BotUseCases {
  listAccounts: {
    execute(userId: string): Promise<LoyaltyAccountReadModel[]>;
  };
  getValueAdvice: {
    execute(userId: string): Promise<ValueAdviceReadModel>;
  };
  chatWithAssistant: {
    execute(input: {
      userId: string;
      message: string;
    }): Promise<{ reply: string }>;
  };
}

export interface CommandInput {
  /** The application user id the chat identity maps to. */
  readonly userId: string;
  /** Everything the user typed after the slash command / bot mention. */
  readonly text: string;
}

const HELP = [
  "PointBot commands:",
  "• `portfolio` — your balances and total value",
  "• `expiring` — programs at risk of expiring",
  "• `value` — best transfers and affordable deals",
  "• `ask <question>` — grounded advice from the assistant",
  "• `help` — this message",
].join("\n");

/**
 * Framework-free command router. Slack/Discord transports parse their own
 * payloads and call this with a resolved `userId` and the raw text.
 */
export async function handleCommand(
  input: CommandInput,
  useCases: BotUseCases,
): Promise<string> {
  const text = input.text.trim();
  const [verb, ...rest] = text.split(/\s+/);
  const keyword = (verb ?? "").toLowerCase();

  switch (keyword) {
    case "":
    case "help":
      return HELP;

    case "portfolio":
    case "balances":
    case "points": {
      const accounts = await useCases.listAccounts.execute(input.userId);
      return formatPortfolio(computePortfolioSummary(accounts), accounts);
    }

    case "expiring":
    case "expire":
    case "expirations": {
      const accounts = await useCases.listAccounts.execute(input.userId);
      return formatExpiring(accounts);
    }

    case "value":
    case "deals":
    case "advice":
    case "transfer":
    case "transfers": {
      const advice = await useCases.getValueAdvice.execute(input.userId);
      return `${formatValueAdvice(advice)}\n\n_${TRANSFER_DISCLAIMER}_`;
    }

    case "ask": {
      const question = rest.join(" ").trim();
      if (!question) return "Ask me something, e.g. `ask should I transfer UR to Hyatt?`";
      return askAssistant(useCases, input.userId, question);
    }

    default:
      // Anything unrecognized is treated as a free-form assistant question.
      return askAssistant(useCases, input.userId, text);
  }
}

async function askAssistant(
  useCases: BotUseCases,
  userId: string,
  message: string,
): Promise<string> {
  const { reply } = await useCases.chatWithAssistant.execute({ userId, message });
  return reply;
}
