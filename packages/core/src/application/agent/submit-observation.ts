import {
  ConsentRequiredError,
  InvalidObservationError,
  LoyaltyAccountNotFoundError,
} from "../../domain/errors";
import { isConsentActive, type ConsentGrantRepository } from "../../domain/agent/consent";
import {
  isImplausibleJump,
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
  /** Set after a human confirmed a value that was held as needs_review. */
  readonly confirmed?: boolean;
}

export interface SubmitObservationResult {
  readonly outcome: ObservationOutcome;
  readonly accountId: string;
  readonly points: number;
  readonly previousPoints: number | null;
  readonly message: string;
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
      if (!input.membershipNumber) {
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

    let outcome: ObservationOutcome;
    let message: string;
    if (previousPoints === input.points) {
      outcome = "unchanged";
      message = "Balance matches the latest reading; nothing written.";
    } else if (
      previousPoints !== null &&
      !input.confirmed &&
      isImplausibleJump(previousPoints, input.points)
    ) {
      outcome = "needs_review";
      message = `Reading ${input.points} differs sharply from ${previousPoints}. Show the user and resubmit with confirmed=true if correct.`;
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
      id: crypto.randomUUID(),
      userId: input.userId,
      accountId: account.id,
      providerId: skill.providerId,
      skillId: skill.id,
      agent: input.agent.slice(0, 64),
      sourceHost: url.hostname,
      points: input.points,
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
    };
  }
}

export class ListAgentObservations {
  constructor(private readonly observations: AgentObservationRepository) {}

  execute(userId: string, limit = 50) {
    return this.observations.findByUserId(userId, Math.min(limit, 200));
  }
}
