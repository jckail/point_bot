import type { Container } from "../container";

/** Existing composed, owner-scoped read services and legacy chat fallback. */
export type AgentUseCases = Pick<Container["useCases"], "getPortfolioSummary" | "listLoyaltyAccounts" | "listTripGoals" | "getValueAdvice" | "chatWithAssistant">;
