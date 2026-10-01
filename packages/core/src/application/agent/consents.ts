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
    for (const existing of await this.consents.findByUserId(input.userId)) {
      if (
        existing.providerId === input.providerId &&
        isConsentActive(existing, now)
      ) {
        await this.consents.update({ ...existing, revokedAt: now });
      }
    }
    const consent = createConsentGrant({ ...input, now });
    await this.consents.insert(consent);
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
    await this.consents.update({ ...consent, revokedAt: this.clock.now() });
  }
}
