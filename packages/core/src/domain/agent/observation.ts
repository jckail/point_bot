import type { LoyaltyAccountId, ObservationId, UserId } from "../shared/ids";
/**
 * Audit record of everything an agent wrote (or tried to write) back. Kept
 * append-only so users can see exactly what an agent did on their behalf.
 */

export const OBSERVATION_OUTCOMES = [
  "recorded",
  "unchanged",
  "needs_review",
  "rejected",
] as const;

export type ObservationOutcome = (typeof OBSERVATION_OUTCOMES)[number];

export interface AgentObservation {
  readonly id: ObservationId;
  readonly userId: UserId;
  readonly accountId: LoyaltyAccountId;
  readonly providerId: string;
  readonly skillId: string;
  /** Free-text agent identity, e.g. "claude-code", "chatgpt", "mcp". */
  readonly agent: string;
  /** Host only (no path/query) - never persist URLs that may carry tokens. */
  readonly sourceHost: string;
  readonly points: number;
  /** Latest known balance when the row was written; null = none yet. */
  readonly previousPoints: number | null;
  readonly outcome: ObservationOutcome;
  readonly observedAt: Date;
  readonly createdAt: Date;
}

export interface AgentObservationRepository {
  insert(observation: AgentObservation): Promise<void>;
  findById(id: ObservationId): Promise<AgentObservation | null>;
  /** Newest first. */
  findByUserId(userId: UserId, limit: number): Promise<AgentObservation[]>;
  /**
   * Atomically moves a row from `from` to `to` and returns it, or null when
   * the row is not (or no longer) in `from`. Makes review ids single-use
   * even under concurrent confirm/reject.
   */
  transition(
    id: ObservationId,
    userId: UserId,
    from: ObservationOutcome,
    to: ObservationOutcome,
  ): Promise<AgentObservation | null>;
}

/** A held reading can be confirmed or rejected for this long. */
export const REVIEW_TTL_MS = 24 * 3_600_000;

export function reviewExpiresAt(observation: AgentObservation): Date {
  return new Date(observation.createdAt.getTime() + REVIEW_TTL_MS);
}

/**
 * Default sanity ceiling for a single reading. A skill may lower or raise it
 * (`maxPoints`); anything above is held for review even as a first reading.
 */
export const DEFAULT_MAX_POINTS = 5_000_000;

export function exceedsSanityCap(points: number, maxPoints: number): boolean {
  return points > maxPoints;
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
