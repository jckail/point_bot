import {
  ConsentRequiredError,
  InvalidObservationError,
  LoyaltyAccountNotFoundError,
  ObservationReviewExpiredError,
  ObservationReviewNotFoundError,
  ObservationReviewResolvedError,
  ObservationReviewStaleError,
} from "../../domain/errors";
import { isConsentActive, type ConsentGrantRepository } from "../../domain/agent/consent";
import {
  exceedsSanityCap,
  isImplausibleJump,
  reviewExpiresAt,
  type AgentObservation,
  type AgentObservationRepository,
  type ObservationOutcome,
} from "../../domain/agent/observation";
import { getSkillOrThrow, isHostAllowed } from "../../domain/agent/skill";
import type {
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { LinkLoyaltyAccount } from "../loyalty/link-loyalty-account";
import type { RecordManualBalance } from "../loyalty/record-manual-balance";

export interface SubmitObservationInput {
  readonly userId: string;
  readonly skillId: string;
  readonly points: number;
  /** Exact page the value was read from; only its host is persisted. */
  readonly sourceUrl: string;
  readonly agent: string;
  readonly observedAt?: Date;
  /**
   * Member number, used only to auto-link a program the user has not linked
   * yet. Ignored when the account already exists.
   */
  readonly membershipNumber?: string;
  /**
   * Whether the caller may create accounts (a session, or a token holding
   * `portfolio:write`). Defaults to false: an observations-only caller must
   * not auto-link, so the user has to link the program first.
   */
  readonly canLinkAccount?: boolean;
}

export interface SubmitObservationResult {
  readonly outcome: ObservationOutcome;
  readonly accountId: string;
  readonly points: number;
  readonly previousPoints: number | null;
  readonly message: string;
  /**
   * Server-issued, single-use id of a held reading (only for needs_review).
   * Only the signed-in user can confirm or reject it; agents cannot.
   */
  readonly reviewId: string | null;
}

/**
 * The single write-back path for agents. Order of checks is deliberate:
 * skill → host allow-list → consent → account → plausibility → write. Every
 * attempt that reaches the account is audited, including held ones.
 */
export class SubmitObservation {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly consents: ConsentGrantRepository,
    private readonly observations: AgentObservationRepository,
    private readonly recordBalance: RecordManualBalance,
    private readonly linkAccount: LinkLoyaltyAccount,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    input: SubmitObservationInput,
  ): Promise<SubmitObservationResult> {
    const skill = getSkillOrThrow(input.skillId);

    let url: URL;
    try {
      url = new URL(input.sourceUrl);
    } catch {
      throw new InvalidObservationError("sourceUrl is not a valid URL");
    }
    if (url.protocol !== "https:") {
      throw new InvalidObservationError("sourceUrl must be https");
    }
    if (!isHostAllowed(skill, url.hostname)) {
      throw new InvalidObservationError(
        `host "${url.hostname}" is not allowed for skill ${skill.id}`,
      );
    }

    const now = this.clock.now();
    const consents = await this.consents.findByUserId(input.userId);
    const consented = consents.some(
      (consent) =>
        consent.providerId === skill.providerId && isConsentActive(consent, now),
    );
    if (!consented) throw new ConsentRequiredError(skill.providerId);

    let account = await this.accounts.findByUserAndProvider(
      input.userId,
      skill.providerId,
    );
    if (account?.deletedAt) {
      // Unlinked recently: the user must restore it deliberately.
      throw new LoyaltyAccountNotFoundError(skill.providerId);
    }
    if (!account) {
      // Creating an account is a portfolio:write effect; observations:write
      // alone must not be able to do it.
      if (!input.membershipNumber || !input.canLinkAccount) {
        throw new LoyaltyAccountNotFoundError(skill.providerId);
      }
      const linked = await this.linkAccount.execute({
        userId: input.userId,
        providerId: skill.providerId,
        membershipNumber: input.membershipNumber,
      });
      account = await this.accounts.findById(linked.accountId);
      if (!account) throw new LoyaltyAccountNotFoundError(skill.providerId);
    }

    const latest = (await this.balances.findLatestByAccountIds([account.id])).get(
      account.id,
    );
    const previousPoints = latest?.points ?? null;
    const observedAt = input.observedAt ?? now;

    const id = crypto.randomUUID();
    let outcome: ObservationOutcome;
    let message: string;
    let reviewId: string | null = null;
    if (previousPoints === input.points) {
      outcome = "unchanged";
      message = "Balance matches the latest reading; nothing written.";
    } else if (
      exceedsSanityCap(input.points, skill.maxPoints) ||
      (previousPoints !== null && isImplausibleJump(previousPoints, input.points))
    ) {
      // Held, not written. Only the signed-in user can release it, via the
      // server-issued review id: there is no agent-supplied override.
      outcome = "needs_review";
      reviewId = id;
      message = `Reading ${input.points} looks implausible${previousPoints === null ? "" : ` (latest is ${previousPoints})`}, so it was NOT saved. Tell the user to open Dashboard > Agents and confirm or reject it. You cannot confirm it yourself.`;
    } else {
      await this.recordBalance.execute({
        userId: input.userId,
        accountId: account.id,
        points: input.points,
        capturedAt: observedAt,
        source: "agent",
      });
      outcome = "recorded";
      message = "Balance recorded.";
    }

    await this.observations.insert({
      id,
      userId: input.userId,
      accountId: account.id,
      providerId: skill.providerId,
      skillId: skill.id,
      agent: input.agent.slice(0, 64),
      sourceHost: url.hostname,
      points: input.points,
      previousPoints,
      outcome,
      observedAt,
      createdAt: now,
    });

    return {
      outcome,
      accountId: account.id,
      points: input.points,
      previousPoints,
      message,
      reviewId,
    };
  }
}

/**
 * Human resolution of a held reading. Both operations are session-only at the
 * API layer; the review id is single-use (claimed atomically) and expires.
 */
export class ResolveObservationReview {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly observations: AgentObservationRepository,
    private readonly recordBalance: RecordManualBalance,
    private readonly clock: Clock = systemClock,
  ) {}

  private async loadPending(
    userId: string,
    reviewId: string,
  ): Promise<AgentObservation> {
    const observation = await this.observations.findById(reviewId);
    if (!observation || observation.userId !== userId) {
      throw new ObservationReviewNotFoundError(reviewId);
    }
    if (observation.outcome !== "needs_review") {
      throw new ObservationReviewResolvedError(reviewId);
    }
    return observation;
  }

  async confirm(userId: string, reviewId: string): Promise<SubmitObservationResult> {
    const held = await this.loadPending(userId, reviewId);
    const now = this.clock.now();
    if (now.getTime() >= reviewExpiresAt(held).getTime()) {
      throw new ObservationReviewExpiredError(reviewId);
    }
    const account = await this.accounts.findById(held.accountId);
    if (!account || account.userId !== userId || account.deletedAt) {
      throw new LoyaltyAccountNotFoundError(held.providerId);
    }
    const latest = (await this.balances.findLatestByAccountIds([account.id])).get(
      account.id,
    );
    if ((latest?.points ?? null) !== held.previousPoints) {
      throw new ObservationReviewStaleError(reviewId);
    }
    const claimed = await this.observations.transition(
      reviewId,
      userId,
      "needs_review",
      "recorded",
    );
    if (!claimed) throw new ObservationReviewResolvedError(reviewId);
    try {
      await this.recordBalance.execute({
        userId,
        accountId: account.id,
        points: held.points,
        capturedAt: held.observedAt,
        source: "agent",
      });
    } catch (error) {
      await this.observations.transition(reviewId, userId, "recorded", "needs_review");
      throw error;
    }
    return {
      outcome: "recorded",
      accountId: account.id,
      points: held.points,
      previousPoints: held.previousPoints,
      message: "Balance recorded after your confirmation.",
      reviewId: null,
    };
  }

  async reject(userId: string, reviewId: string): Promise<SubmitObservationResult> {
    const held = await this.loadPending(userId, reviewId);
    const claimed = await this.observations.transition(
      reviewId,
      userId,
      "needs_review",
      "rejected",
    );
    if (!claimed) throw new ObservationReviewResolvedError(reviewId);
    return {
      outcome: "rejected",
      accountId: held.accountId,
      points: held.points,
      previousPoints: held.previousPoints,
      message: "Reading discarded.",
      reviewId: null,
    };
  }
}

export class ListAgentObservations {
  constructor(private readonly observations: AgentObservationRepository) {}

  execute(userId: string, limit = 50) {
    return this.observations.findByUserId(userId, Math.min(limit, 200));
  }
}
