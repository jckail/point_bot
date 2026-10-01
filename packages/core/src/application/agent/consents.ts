import { ConsentNotFoundError } from "../../domain/errors";
import {
  createConsentGrant,
  isConsentActive,
  type ConsentGrant,
  type ConsentGrantRepository,
} from "../../domain/agent/consent";
import { getProviderOrThrow } from "../../domain/loyalty/provider";
import type { Clock } from "../ports";
import { systemClock } from "../ports";

export interface ConsentReadModel {
  readonly id: string;
  readonly providerId: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly active: boolean;
}

function toReadModel(consent: ConsentGrant, now: Date): ConsentReadModel {
  return { ...consent, active: isConsentActive(consent, now) };
}

export class GrantConsent {
  constructor(
    private readonly consents: ConsentGrantRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Re-granting replaces any active consent for the provider (renewal). */
  async execute(input: {
    userId: string;
    providerId: string;
    days?: number;
  }): Promise<ConsentReadModel> {
    getProviderOrThrow(input.providerId);
    const now = this.clock.now();
    const consent = createConsentGrant({ ...input, now });
    // Revoke-then-insert in one transaction (see the repository); a partial
    // unique index guarantees one active grant per (user, provider).
    await this.consents.replaceActive(consent, now);
    return toReadModel(consent, now);
  }
}

export class ListConsents {
  constructor(
    private readonly consents: ConsentGrantRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(userId: string): Promise<ConsentReadModel[]> {
    const now = this.clock.now();
    return (await this.consents.findByUserId(userId)).map((consent) =>
      toReadModel(consent, now),
    );
  }
}

export class RevokeConsent {
  constructor(
    private readonly consents: ConsentGrantRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(userId: string, consentId: string): Promise<void> {
    const consent = await this.consents.findById(consentId);
    if (!consent || consent.userId !== userId) {
      throw new ConsentNotFoundError(consentId);
    }
    if (consent.revokedAt) return;
    const now = this.clock.now();
    // Revoke every open grant for the provider, so no stray duplicate keeps
    // consent alive after the user pressed "revoke".
    const open = (await this.consents.findByUserId(userId)).filter(
      (c) => c.providerId === consent.providerId && !c.revokedAt,
    );
    for (const grant of open) {
      await this.consents.update({ ...grant, revokedAt: now });
    }
  }
}
