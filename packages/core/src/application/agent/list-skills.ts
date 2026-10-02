import {
  AGENT_SKILL_CATALOG,
  type AgentSkill,
} from "../../domain/agent/skill";
import { isConsentActive, type ConsentGrantRepository } from "../../domain/agent/consent";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";

import type { UserId } from "../../domain/shared/ids";
export interface AgentSkillReadModel extends AgentSkill {
  /** The user has linked this program. */
  readonly accountLinked: boolean;
  /** An unexpired, unrevoked consent exists - the skill may write back. */
  readonly consentActive: boolean;
}

/** The skill catalog annotated with what this user has set up. */
export class ListAgentSkills {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly consents: ConsentGrantRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    userId: UserId,
    filter?: { providerId?: string },
  ): Promise<AgentSkillReadModel[]> {
    const now = this.clock.now();
    const [accounts, consents] = await Promise.all([
      this.accounts.findByUserId(userId),
      this.consents.findByUserId(userId),
    ]);
    const linked = new Set(accounts.map((account) => account.providerId));
    const consented = new Set(
      consents
        .filter((consent) => isConsentActive(consent, now))
        .map((consent) => consent.providerId),
    );
    return AGENT_SKILL_CATALOG.filter(
      (skill) => !filter?.providerId || skill.providerId === filter.providerId,
    ).map((skill) => ({
      ...skill,
      accountLinked: linked.has(skill.providerId),
      consentActive: consented.has(skill.providerId),
    }));
  }
}
