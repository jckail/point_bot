import {
  AssistantUnavailableError,
  InvalidAssistantMessageError,
} from "../../domain/errors";
import { rankTransferAdvice } from "../../domain/loyalty/transfer-ranking";
import { isTransferBonusSource, type TransferBonus } from "../../domain/loyalty/transfer-bonus";
import {
  CATALOG_DEALS,
  rankDeals,
  type RankedDeal,
} from "../../domain/loyalty/deals";
import { PROVIDER_CATALOG } from "../../domain/loyalty/provider";
import type { AssistantMessage, Clock, LlmAssistant } from "../ports";
import { systemClock } from "../ports";
import type { TripGoalReadModel } from "./create-trip-goal";
import {
  computePortfolioSummary,
  type PortfolioSummaryReadModel,
} from "./get-portfolio-summary";
import type { ListLoyaltyAccounts } from "./list-loyalty-accounts";
import type { ListTripGoals } from "./list-trip-goals";
import type { ListActiveTransferBonuses } from "./transfer-bonuses";
import type { LoyaltyAccountReadModel } from "./read-models";

import type { UserId } from "../../domain/shared/ids";
export interface AssistantPortfolioContext {
  readonly summary: PortfolioSummaryReadModel;
  readonly accounts: readonly LoyaltyAccountReadModel[];
  readonly goals: readonly TripGoalReadModel[];
  /** Top transfer / redemption hints for grounding the model. */
  readonly valueHints: readonly string[];
  readonly eligibilityWarnings: ReturnType<typeof rankTransferAdvice>["eligibilityWarnings"];
}

function buildValueHints(
  accounts: readonly LoyaltyAccountReadModel[],
  bonuses: readonly TransferBonus[],
  now: Date,
): Pick<AssistantPortfolioContext, "valueHints" | "eligibilityWarnings"> {
  const hints: string[] = [];
  const eligibilityWarnings: ReturnType<typeof rankTransferAdvice>["eligibilityWarnings"] = [];
  for (const account of accounts) {
    const points = account.latestBalance?.points ?? 0;
    if (points <= 0) continue;
    const advice = rankTransferAdvice(account.provider.id, points, bonuses, now, { cardProductId: account.cardProductId ?? null });
    eligibilityWarnings.push(...advice.eligibilityWarnings);
    const transfers = advice.options.slice(0, 2);
    for (const option of transfers) {
      // Keep verification evidence with the numeric yield. A source alone
      // never establishes verification; missing legacy metadata is unknown.
      const bonusHint = option.bonusMultiplier > 1
        ? `, ${option.bonusLabel ?? "bonus"} [${option.bonusVerified === true ? "verified" : "unverified"}; source: ${isTransferBonusSource(option.bonusSource) ? option.bonusSource : "unknown"}]`
        : "";
      hints.push(
        `${account.provider.displayName} ${points.toLocaleString("en-US")} → ${option.destinationPoints.toLocaleString("en-US")} ${option.to.displayName} (~${option.effectiveCentsPerPoint}¢/pt${bonusHint})`,
      );
    }
  }
  return { valueHints: hints.slice(0, 8), eligibilityWarnings };
}

export function assembleAssistantContext(
  accounts: readonly LoyaltyAccountReadModel[],
  goals: readonly TripGoalReadModel[],
  bonuses: readonly TransferBonus[] = [],
  now: Date = new Date(),
): AssistantPortfolioContext {
  return {
    summary: computePortfolioSummary(accounts),
    accounts,
    goals: goals.filter((goal) => goal.status === "active"),
    ...buildValueHints(accounts, bonuses, now),
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
  if (context.eligibilityWarnings.length > 0) {
    lines.push("Transfer eligibility warnings (do not invent a ratio or transfer access):");
    for (const warning of context.eligibilityWarnings) lines.push(`- ${warning.message}`);
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are PointUp Assistant — a concise, practical loyalty-points advisor.
Help the user manage airline, hotel, credit-card, rail, car-rental, cruise, rideshare, dining, and shopping points.
Prioritize: (1) avoiding expirations, (2) transfer bonuses and high cents-per-point redemptions, (3) progress toward their trip goals.
Never invent balances. Use only the portfolio context provided.
Never ask for or repeat passwords or membership secrets beyond what is already in context.
Keep answers short (under ~180 words) with concrete next steps.
When recommending transfers, name the source and destination programs and approximate value.
Preserve the bonus verification and source qualifications in transfer hints; a manual, scraped, or user source alone never proves verification. Require confirmation against the issuer before recommending a transfer that relies on an unverified or unknown bonus.
Use only eligible transfer hints. If card eligibility or its transfer rule is unknown, explain the warning and ask the user to confirm their transfer card; never assume a ratio or combine cards automatically.`;

export interface ChatWithAssistantInput {
  readonly userId: UserId;
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
    private readonly bonuses?: ListActiveTransferBonuses,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    input: ChatWithAssistantInput,
  ): Promise<ChatWithAssistantResult> {
    const message = input.message.trim();
    if (message.length < 1 || message.length > 4000) {
      throw new InvalidAssistantMessageError();
    }

    const [accounts, goals, bonuses] = await Promise.all([
      this.listAccounts.execute(input.userId),
      this.listGoals.execute(input.userId),
      this.bonuses?.execute(input.userId) ?? Promise.resolve([]),
    ]);
    const context = assembleAssistantContext(accounts, goals, bonuses, this.clock.now());
    const history = (input.history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8);

    try {
      const reply = await this.llm.complete({
        system: `${SYSTEM_PROMPT}\n\nCurrent portfolio context:\n${formatContextBlock(context)}`,
        messages: [...history, { role: "user", content: message }],
      });
      return { reply, context };
    } catch {
      throw new AssistantUnavailableError("Please try again later.");
    }
  }
}

export interface ValueAdviceReadModel {
  readonly transfers: ReturnType<typeof rankTransferAdvice>["options"];
  readonly deals: RankedDeal[];
  readonly eligibilityWarnings: ReturnType<typeof rankTransferAdvice>["eligibilityWarnings"];
}

/**
 * Bang-for-buck advisor: ranks transfer options across the user's balances
 * and scores curated (plus optional scraped) deals against what they hold.
 */
export class GetValueAdvice {
  constructor(
    private readonly listAccounts: ListLoyaltyAccounts,
    private readonly bonuses?: ListActiveTransferBonuses,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    userId: UserId,
    extraDeals: readonly import("../../domain/loyalty/deals").DealCandidate[] = [],
  ): Promise<ValueAdviceReadModel> {
    const [accounts, bonuses] = await Promise.all([
      this.listAccounts.execute(userId),
      this.bonuses?.execute(userId) ?? Promise.resolve([]),
    ]);
    const balances = new Map<string, number>();
    for (const account of accounts) {
      balances.set(account.provider.id, account.latestBalance?.points ?? 0);
    }

    const now = this.clock.now();
    const advice = accounts.map((account) => rankTransferAdvice(
      account.provider.id,
      account.latestBalance?.points ?? 0,
      bonuses,
      now,
      { cardProductId: account.cardProductId ?? null },
    ));
    const transfers = advice
      .flatMap((entry) => entry.options.slice(0, 3))
      .sort((a, b) => b.effectiveCentsPerPoint - a.effectiveCentsPerPoint)
      .slice(0, 10);
    const eligibilityWarnings = advice.flatMap((entry) => entry.eligibilityWarnings);

    const editorial = new Map(
      PROVIDER_CATALOG.map((p) => [p.id, p.estimatedCentsPerPoint] as const),
    );
    const deals = rankDeals(
      [...CATALOG_DEALS, ...extraDeals],
      balances,
      editorial,
      { now, bonuses, accountContexts: new Map(accounts.map(account => [account.provider.id, { cardProductId: account.cardProductId ?? null }])) },
    );
    for (const warning of deals.flatMap(deal => deal.eligibilityWarnings ?? [])) {
      if (!eligibilityWarnings.some(existing => existing.fromProviderId === warning.fromProviderId
        && existing.toProviderId === warning.toProviderId && existing.code === warning.code
        && existing.cardProductId === warning.cardProductId)) eligibilityWarnings.push(warning);
    }

    return { transfers, deals, eligibilityWarnings };
  }
}
