import {
  AssistantUnavailableError,
  InvalidAssistantMessageError,
} from "../../domain/errors";
import { rankTransferOptions } from "../../domain/loyalty/transfer-partners";
import {
  CATALOG_DEALS,
  rankDeals,
  type RankedDeal,
} from "../../domain/loyalty/deals";
import { PROVIDER_CATALOG } from "../../domain/loyalty/provider";
import type { AssistantMessage, LlmAssistant } from "../ports";
import type { TripGoalReadModel } from "./create-trip-goal";
import {
  computePortfolioSummary,
  type PortfolioSummaryReadModel,
} from "./get-portfolio-summary";
import type { ListLoyaltyAccounts } from "./list-loyalty-accounts";
import type { ListTripGoals } from "./list-trip-goals";
import type { LoyaltyAccountReadModel } from "./read-models";

export interface AssistantPortfolioContext {
  readonly summary: PortfolioSummaryReadModel;
  readonly accounts: readonly LoyaltyAccountReadModel[];
  readonly goals: readonly TripGoalReadModel[];
  /** Top transfer / redemption hints for grounding the model. */
  readonly valueHints: readonly string[];
}

function buildValueHints(
  accounts: readonly LoyaltyAccountReadModel[],
): string[] {
  const hints: string[] = [];
  for (const account of accounts) {
    const points = account.latestBalance?.points ?? 0;
    if (points <= 0) continue;
    const transfers = rankTransferOptions(account.provider.id, points).slice(
      0,
      2,
    );
    for (const option of transfers) {
      hints.push(
        `${account.provider.displayName} ${points.toLocaleString("en-US")} → ${option.destinationPoints.toLocaleString("en-US")} ${option.to.displayName} (~${option.effectiveCentsPerPoint}¢/pt${option.bonusLabel ? `, ${option.bonusLabel}` : ""})`,
      );
    }
  }
  return hints.slice(0, 8);
}

export function assembleAssistantContext(
  accounts: readonly LoyaltyAccountReadModel[],
  goals: readonly TripGoalReadModel[],
): AssistantPortfolioContext {
  return {
    summary: computePortfolioSummary(accounts),
    accounts,
    goals: goals.filter((goal) => goal.status === "active"),
    valueHints: buildValueHints(accounts),
  };
}

function formatContextBlock(context: AssistantPortfolioContext): string {
  const lines: string[] = [
    `Portfolio: ${context.summary.accountCount} programs, ${context.summary.totalPoints.toLocaleString("en-US")} points, ~$${(context.summary.totalValueCents / 100).toFixed(0)} estimated value.`,
    "Balances:",
  ];
  for (const account of context.accounts) {
    const pts = account.latestBalance?.points ?? 0;
    lines.push(
      `- ${account.provider.displayName} (${account.provider.id}): ${pts.toLocaleString("en-US")} ${account.provider.pointsCurrency}; editorial ${account.provider.estimatedCentsPerPoint}¢/pt; tags=[${account.tags.join(",")}]`,
    );
  }
  if (context.goals.length > 0) {
    lines.push("Active trip goals:");
    for (const goal of context.goals) {
      lines.push(
        `- ${goal.title}: ${goal.currentPoints}/${goal.targetPoints} (${goal.percentComplete}%)`,
      );
    }
  }
  if (context.valueHints.length > 0) {
    lines.push("Transfer / value hints:");
    for (const hint of context.valueHints) {
      lines.push(`- ${hint}`);
    }
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are PointUp Assistant — a concise, practical loyalty-points advisor.
Help the user manage airline, hotel, credit-card, rail, and shopping points.
Prioritize: (1) avoiding expirations, (2) transfer bonuses and high cents-per-point redemptions, (3) progress toward their trip goals.
Never invent balances. Use only the portfolio context provided.
Never ask for or repeat passwords or membership secrets beyond what is already in context.
Keep answers short (under ~180 words) with concrete next steps.
When recommending transfers, name the source and destination programs and approximate value.`;

export interface ChatWithAssistantInput {
  readonly userId: string;
  readonly message: string;
  readonly history?: readonly AssistantMessage[];
}

export interface ChatWithAssistantResult {
  readonly reply: string;
  readonly context: AssistantPortfolioContext;
}

/**
 * Grounded portfolio chat. Assembles read models, builds a system prompt with
 * balances/goals/transfer hints, and delegates completion to the LlmAssistant port.
 */
export class ChatWithAssistant {
  constructor(
    private readonly listAccounts: ListLoyaltyAccounts,
    private readonly listGoals: ListTripGoals,
    private readonly llm: LlmAssistant,
  ) {}

  async execute(
    input: ChatWithAssistantInput,
  ): Promise<ChatWithAssistantResult> {
    const message = input.message.trim();
    if (message.length < 1 || message.length > 4000) {
      throw new InvalidAssistantMessageError();
    }

    const [accounts, goals] = await Promise.all([
      this.listAccounts.execute(input.userId),
      this.listGoals.execute(input.userId),
    ]);
    const context = assembleAssistantContext(accounts, goals);
    const history = (input.history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8);

    try {
      const reply = await this.llm.complete({
        system: `${SYSTEM_PROMPT}\n\nCurrent portfolio context:\n${formatContextBlock(context)}`,
        messages: [...history, { role: "user", content: message }],
      });
      return { reply, context };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "unknown LLM error";
      throw new AssistantUnavailableError(reason);
    }
  }
}

export interface ValueAdviceReadModel {
  readonly transfers: ReturnType<typeof rankTransferOptions>;
  readonly deals: RankedDeal[];
}

/**
 * Bang-for-buck advisor: ranks transfer options across the user's balances
 * and scores curated (plus optional scraped) deals against what they hold.
 */
export class GetValueAdvice {
  constructor(private readonly listAccounts: ListLoyaltyAccounts) {}

  async execute(
    userId: string,
    extraDeals: readonly import("../../domain/loyalty/deals").DealCandidate[] = [],
  ): Promise<ValueAdviceReadModel> {
    const accounts = await this.listAccounts.execute(userId);
    const balances = new Map<string, number>();
    for (const account of accounts) {
      balances.set(account.provider.id, account.latestBalance?.points ?? 0);
    }

    const transfers = accounts
      .flatMap((account) =>
        rankTransferOptions(
          account.provider.id,
          account.latestBalance?.points ?? 0,
        ).slice(0, 3),
      )
      .sort((a, b) => b.effectiveCentsPerPoint - a.effectiveCentsPerPoint)
      .slice(0, 10);

    const editorial = new Map(
      PROVIDER_CATALOG.map((p) => [p.id, p.estimatedCentsPerPoint] as const),
    );
    const deals = rankDeals(
      [...CATALOG_DEALS, ...extraDeals],
      balances,
      editorial,
    );

    return { transfers, deals };
  }
}
