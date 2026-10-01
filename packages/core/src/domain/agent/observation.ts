/**
 * Audit record of everything an agent wrote (or tried to write) back. Kept
 * append-only so users can see exactly what an agent did on their behalf.
 */

export const OBSERVATION_OUTCOMES = [
  "recorded",
  "unchanged",
  "needs_review",
] as const;

export type ObservationOutcome = (typeof OBSERVATION_OUTCOMES)[number];

export interface AgentObservation {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly providerId: string;
  readonly skillId: string;
  /** Free-text agent identity, e.g. "claude-code", "chatgpt", "mcp". */
  readonly agent: string;
  /** Host only (no path/query) - never persist URLs that may carry tokens. */
  readonly sourceHost: string;
  readonly points: number;
  readonly outcome: ObservationOutcome;
  readonly observedAt: Date;
  readonly createdAt: Date;
}

export interface AgentObservationRepository {
  insert(observation: AgentObservation): Promise<void>;
  /** Newest first. */
  findByUserId(userId: string, limit: number): Promise<AgentObservation[]>;
}

/**
 * Guardrail against mis-scraped values: a reading that moves more than this
 * ratio away from the last known balance is held for human confirmation.
 */
export const IMPLAUSIBLE_RATIO = 10;

export function isImplausibleJump(previous: number, next: number): boolean {
  if (previous === 0) return next > 5_000_000;
  if (next === 0) return previous > 0;
  const ratio = next > previous ? next / previous : previous / next;
  return ratio >= IMPLAUSIBLE_RATIO;
}
