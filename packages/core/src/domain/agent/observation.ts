import type { AccessTokenId, LoyaltyAccountId, ObservationId, UserId } from "../shared/ids";
import type { ConsentGrant } from "./consent";
import type { LoyaltyAccount } from "../loyalty/loyalty-account";
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

/** Supplied by the authenticated adapter, never by observation JSON or agent labels. */
export type ObservationCredential =
  | { readonly kind: "session" | "clerk_bearer"; readonly tokenId?: never }
  | { readonly kind: "personal_access_token"; readonly tokenId: AccessTokenId };
export type ObservationSourceMethod = "page_capture" | "manual_entry" | "unknown";

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
  /** Optional fields keep historical/fake rows readable without inventing provenance. */
  readonly provenanceVersion?: 0 | 1;
  readonly credentialKind?: ObservationCredential["kind"] | null;
  readonly accessTokenId?: string | null;
  readonly consentId?: string | null;
  readonly consentGrantedAt?: Date | null;
  readonly consentExpiresAt?: Date | null;
  readonly skillVersion?: number | null;
  readonly sourceMethod?: ObservationSourceMethod | null;
  readonly captureId?: string | null;
  readonly payloadHash?: string | null;
  readonly baselineSnapshotId?: string | null;
  readonly recordedSnapshotId?: string | null;
  readonly reviewExpiresAt?: Date | null;
  readonly reviewedAt?: Date | null;
  readonly reviewDecision?: "confirm" | "reject" | null;
}

export interface AgentObservationRepository {
  /** Call only inside an atomic UOW; returned witnesses stay locked until commit. */
  lockSubmission?(input: {
    userId: UserId;
    providerId: string;
    credential?: ObservationCredential;
    captureId?: string;
    canLinkAccount?: boolean;
  }, now: () => Date): Promise<{
    consent: ConsentGrant;
    account: LoyaltyAccount | null;
    assertAuthorized: () => void;
  }>;
  /** Read under the submission's owner/capture lock, before auto-link effects. */
  findByCaptureId?(userId: UserId, captureId: string): Promise<AgentObservation | null>;
  /** Serializes the provider/account and then the owned receipt. */
  lockReview?(id: ObservationId, userId: UserId): Promise<AgentObservation | null>;
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
    metadata?: {
      reviewedAt: Date;
      reviewDecision: "confirm" | "reject";
      recordedSnapshotId?: string;
    },
  ): Promise<AgentObservation | null>;
}

/** Confirmation expires after this window; owner rejection remains available for cleanup. */
export const REVIEW_TTL_MS = 24 * 3_600_000;

export function reviewExpiresAt(observation: AgentObservation): Date {
  return observation.reviewExpiresAt ?? new Date(observation.createdAt.getTime() + REVIEW_TTL_MS);
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
