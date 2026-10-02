import { createHash } from "node:crypto";
import { z } from "zod";
import { createDomainEvent } from "../../domain/events";
import { noopEventing, type Eventing } from "../events/ports";
import {
  InvalidObservationError,
  LoyaltyAccountNotFoundError,
  ObservationReplayConflictError,
  ObservationReviewExpiredError,
  ObservationReviewNotFoundError,
  ObservationReviewResolvedError,
  ObservationReviewStaleError,
} from "../../domain/errors";
import type { ConsentGrantRepository } from "../../domain/agent/consent";
import {
  exceedsSanityCap,
  isImplausibleJump,
  reviewExpiresAt,
  REVIEW_TTL_MS,
  type AgentObservation,
  type AgentObservationRepository,
  type ObservationCredential,
  type ObservationOutcome,
  type ObservationSourceMethod,
} from "../../domain/agent/observation";
import { getSkillOrThrow, isHostAllowed } from "../../domain/agent/skill";
import type { BalanceSnapshotRepository, LoyaltyAccountRepository } from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { LinkLoyaltyAccount } from "../loyalty/link-loyalty-account";
import type { RecordManualBalance } from "../loyalty/record-manual-balance";
import { type LoyaltyAccountId, ObservationId, type UserId } from "../../domain/shared/ids";

export interface SubmitObservationInput {
  readonly userId: UserId;
  readonly skillId: string;
  readonly points: number;
  /** Exact provider claim; only its host and a payload digest are persisted. */
  readonly sourceUrl: string;
  /** Display label, not authenticated provenance. */
  readonly agent: string;
  readonly observedAt?: Date;
  readonly membershipNumber?: string;
  readonly canLinkAccount?: boolean;
  /** Authenticated adapter only. Omission preserves legacy direct-call provenance. */
  readonly credential?: ObservationCredential;
  readonly captureId?: string;
  readonly sourceMethod?: Exclude<ObservationSourceMethod, "unknown">;
}

export interface SubmitObservationResult {
  readonly outcome: ObservationOutcome;
  readonly accountId: LoyaltyAccountId;
  readonly points: number;
  readonly previousPoints: number | null;
  readonly message: string;
  readonly reviewId: ObservationId | null;
  /** Existing server-issued receipt ID, including outcomes without a review. */
  readonly observationId?: ObservationId;
}

function resultFor(observation: AgentObservation): SubmitObservationResult {
  let message: string;
  switch (observation.outcome) {
    case "unchanged": message = "Balance matches the latest reading; nothing written."; break;
    case "needs_review":
      message = `Reading ${observation.points} looks implausible${observation.previousPoints === null ? "" : ` (latest is ${observation.previousPoints})`}, so it was NOT saved. Tell the user to open Dashboard > Agents and confirm or reject it. You cannot confirm it yourself.`;
      break;
    case "rejected": message = "Reading discarded."; break;
    case "recorded": message = observation.reviewDecision === "confirm" ? "Balance recorded after your confirmation." : "Balance recorded."; break;
  }
  return {
    outcome: observation.outcome, accountId: observation.accountId, points: observation.points,
    previousPoints: observation.previousPoints, message,
    reviewId: observation.outcome === "needs_review" ? observation.id : null,
    observationId: observation.id,
  };
}

function requireAtomic(eventing: Eventing): void {
  if (!eventing.unitOfWork.atomic) throw new Error("Observation writes require an atomic unit of work");
}

/** Fingerprints claims, not current credentials: authorized rotation can replay the same receipt. */
function fingerprint(input: SubmitObservationInput, accountId: LoyaltyAccountId, providerId: string, skillVersion: number, source: URL): string {
  return createHash("sha256").update(JSON.stringify([
    1, input.userId, accountId, providerId, input.skillId, skillVersion, input.points,
    // Stable omission marker: retries must not depend on a new server timestamp.
    input.observedAt?.toISOString() ?? null, source.href, input.sourceMethod ?? "unknown", input.agent,
    input.membershipNumber ?? null,
  ])).digest("hex");
}

/** Locked authorization, baseline, balance, receipt and events share the ambient transaction. */
export class SubmitObservation {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    _consents: ConsentGrantRepository,
    private readonly observations: AgentObservationRepository,
    private readonly recordBalance: RecordManualBalance,
    private readonly linkAccount: LinkLoyaltyAccount,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(input: SubmitObservationInput): Promise<SubmitObservationResult> {
    requireAtomic(this.eventing);
    const { observations } = this;
    if (!observations.lockSubmission || !observations.findByCaptureId) {
      throw new Error("Observation repository does not support protected submissions");
    }
    const lockSubmission = observations.lockSubmission.bind(observations);
    const findByCaptureId = observations.findByCaptureId.bind(observations);
    const skill = getSkillOrThrow(input.skillId);
    if (!Number.isSafeInteger(input.points) || input.points < 0) throw new InvalidObservationError("points must be a non-negative safe integer");
    if (typeof input.agent !== "string" || !input.agent || input.agent.length > 64) throw new InvalidObservationError("agent label must contain 1–64 characters");
    if (input.sourceMethod !== undefined && input.sourceMethod !== "page_capture" && input.sourceMethod !== "manual_entry") {
      throw new InvalidObservationError("capture method is invalid");
    }
    let source: URL;
    try { source = new URL(input.sourceUrl); } catch { throw new InvalidObservationError("sourceUrl is not a valid URL"); }
    if (source.protocol !== "https:" || source.username || source.password || (source.port && source.port !== "443")) {
      throw new InvalidObservationError("sourceUrl must use HTTPS without credentials or a nonstandard port");
    }
    if (!isHostAllowed(skill, source.hostname)) throw new InvalidObservationError("source host is not allowed for this skill");
    if (input.captureId !== undefined && !z.uuid().safeParse(input.captureId).success) {
      throw new InvalidObservationError("captureId must be a UUID");
    }
    const captureId = input.captureId?.toLowerCase();
    const startedAt = this.clock.now();
    const now = () => new Date(Math.max(startedAt.getTime(), this.clock.now().getTime()));
    if (input.observedAt && (!Number.isFinite(input.observedAt.getTime()) || input.observedAt.getTime() > now().getTime())) {
      throw new InvalidObservationError("capture time must be valid and not in the future");
    }

    return this.eventing.unitOfWork.run(async () => {
      const locked = await lockSubmission({
        userId: input.userId, providerId: skill.providerId,
        ...(input.credential ? { credential: input.credential } : {}),
        ...(captureId ? { captureId } : {}),
        ...(input.canLinkAccount !== undefined ? { canLinkAccount: input.canLinkAccount } : {}),
      }, now);
      locked.assertAuthorized();
      // Authorization precedes replay, including current token/grant expiry and revocation.
      const existing = captureId ? await findByCaptureId(input.userId, captureId) : null;
      if (existing) {
        locked.assertAuthorized();
        if (existing.payloadHash !== fingerprint(input, existing.accountId, skill.providerId, existing.skillVersion ?? skill.version, source)) {
          throw new ObservationReplayConflictError();
        }
        return resultFor(existing);
      }

      let account = locked.account;
      if (!account) {
        if (!input.membershipNumber || !input.canLinkAccount) throw new LoyaltyAccountNotFoundError(skill.providerId);
        locked.assertAuthorized();
        const linked = await this.linkAccount.execute({ userId: input.userId, providerId: skill.providerId, membershipNumber: input.membershipNumber });
        account = await this.accounts.findById(linked.accountId);
      }
      if (!account || account.userId !== input.userId || account.providerId !== skill.providerId || account.deletedAt) {
        throw new LoyaltyAccountNotFoundError(skill.providerId);
      }
      const latest = (await this.balances.findLatestByAccountIds([account.id])).get(account.id);
      const previousPoints = latest?.points ?? null;
      const observedAt = input.observedAt ?? startedAt;
      let outcome: ObservationOutcome;
      let recordedSnapshotId: string | null = null;
      if (previousPoints === input.points) outcome = "unchanged";
      else if (exceedsSanityCap(input.points, skill.maxPoints) || (previousPoints !== null && isImplausibleJump(previousPoints, input.points))) outcome = "needs_review";
      else {
        locked.assertAuthorized();
        recordedSnapshotId = (await this.recordBalance.executeWithSnapshotId({
          userId: input.userId, accountId: account.id, points: input.points, capturedAt: observedAt, source: "agent",
        })).snapshotId;
        outcome = "recorded";
      }
      locked.assertAuthorized();
      const createdAt = now();
      const observation: AgentObservation = {
        id: ObservationId.generate(), userId: input.userId, accountId: account.id, providerId: skill.providerId,
        skillId: skill.id, agent: input.agent, sourceHost: source.hostname, points: input.points, previousPoints,
        outcome, observedAt, createdAt,
        provenanceVersion: input.credential ? 1 : 0,
        credentialKind: input.credential?.kind ?? null,
        accessTokenId: input.credential?.kind === "personal_access_token" ? input.credential.tokenId : null,
        consentId: locked.consent.id, consentGrantedAt: locked.consent.grantedAt, consentExpiresAt: locked.consent.expiresAt,
        skillVersion: skill.version, sourceMethod: input.sourceMethod ?? "unknown", captureId: captureId ?? null,
        payloadHash: fingerprint(input, account.id, skill.providerId, skill.version, source),
        baselineSnapshotId: latest?.id ?? null, recordedSnapshotId,
        reviewExpiresAt: outcome === "needs_review" ? new Date(createdAt.getTime() + REVIEW_TTL_MS) : null,
        reviewedAt: null, reviewDecision: null,
      };
      await observations.insert(observation);
      if (outcome === "needs_review") {
        await this.eventing.publisher.publish([createDomainEvent("observation.held", {
          userId: input.userId, aggregateId: observation.id, occurredAt: createdAt,
          payload: { accountId: account.id, providerId: skill.providerId, points: input.points, previousPoints, reviewExpiresAt: reviewExpiresAt(observation).toISOString() },
        })]);
      }
      locked.assertAuthorized();
      return resultFor(observation);
    });
  }
}

/** Human resolution: protected account/receipt, live expiry, exact baseline, atomic effects. */
export class ResolveObservationReview {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly observations: AgentObservationRepository,
    private readonly recordBalance: RecordManualBalance,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  private async loadPending(userId: UserId, reviewId: ObservationId): Promise<AgentObservation> {
    if (!this.observations.lockReview) throw new Error("Observation repository does not support protected reviews");
    const observation = await this.observations.lockReview(reviewId, userId);
    if (!observation || observation.userId !== userId) throw new ObservationReviewNotFoundError(reviewId);
    if (observation.outcome !== "needs_review") throw new ObservationReviewResolvedError(reviewId);
    return observation;
  }

  async confirm(userId: UserId, reviewId: ObservationId): Promise<SubmitObservationResult> {
    requireAtomic(this.eventing);
    return this.eventing.unitOfWork.run(async () => {
      const held = await this.loadPending(userId, reviewId);
      const assertUnexpired = () => {
        if (this.clock.now().getTime() >= reviewExpiresAt(held).getTime()) throw new ObservationReviewExpiredError(reviewId);
      };
      assertUnexpired();
      const account = await this.accounts.findById(held.accountId);
      if (!account || account.userId !== userId || account.providerId !== held.providerId || account.deletedAt) throw new LoyaltyAccountNotFoundError(held.providerId);
      const latest = (await this.balances.findLatestByAccountIds([account.id])).get(account.id);
      const hasSnapshotWitness = held.provenanceVersion === 1 || typeof held.payloadHash === "string";
      if ((hasSnapshotWitness && (latest?.id ?? null) !== (held.baselineSnapshotId ?? null)) ||
          (!hasSnapshotWitness && (latest?.points ?? null) !== held.previousPoints)) throw new ObservationReviewStaleError(reviewId);
      assertUnexpired();
      const { snapshotId } = await this.recordBalance.executeWithSnapshotId({
        userId, accountId: account.id, points: held.points, capturedAt: held.observedAt, source: "agent",
      });
      assertUnexpired();
      const reviewedAt = this.clock.now();
      const confirmed = await this.observations.transition(reviewId, userId, "needs_review", "recorded", {
        reviewedAt, reviewDecision: "confirm", recordedSnapshotId: snapshotId,
      });
      if (!confirmed) throw new ObservationReviewResolvedError(reviewId);
      await this.eventing.publisher.publish([createDomainEvent("observation.confirmed", {
        userId, aggregateId: held.id, occurredAt: reviewedAt,
        payload: { accountId: account.id, providerId: held.providerId, points: held.points, previousPoints: held.previousPoints },
      })]);
      assertUnexpired();
      return resultFor(confirmed);
    });
  }

  /** Expired receipts may still be rejected by their owner as harmless cleanup. */
  async reject(userId: UserId, reviewId: ObservationId): Promise<SubmitObservationResult> {
    requireAtomic(this.eventing);
    return this.eventing.unitOfWork.run(async () => {
      const held = await this.loadPending(userId, reviewId);
      const reviewedAt = this.clock.now();
      const rejected = await this.observations.transition(reviewId, userId, "needs_review", "rejected", { reviewedAt, reviewDecision: "reject" });
      if (!rejected) throw new ObservationReviewResolvedError(reviewId);
      await this.eventing.publisher.publish([createDomainEvent("observation.rejected", {
        userId, aggregateId: held.id, occurredAt: reviewedAt,
        payload: { accountId: held.accountId, providerId: held.providerId, points: held.points, previousPoints: held.previousPoints },
      })]);
      return resultFor(rejected);
    });
  }
}

export class ListAgentObservations {
  constructor(private readonly observations: AgentObservationRepository) {}
  execute(userId: UserId, limit = 50) { return this.observations.findByUserId(userId, Math.min(limit, 200)); }
}
