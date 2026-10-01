import { InvalidConsentError } from "../errors";

/**
 * A ConsentGrant is the user's explicit, time-boxed permission for agents to
 * read one loyalty program's data from the user's own browser/computer and
 * write the observed balance back. No consent → no write-back, regardless of
 * token scopes. Consents are per provider, expire, and are revocable.
 */

export const DEFAULT_CONSENT_DAYS = 30;
export const MAX_CONSENT_DAYS = 90;

export interface ConsentGrant {
  readonly id: string;
  readonly userId: string;
  readonly providerId: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export function isConsentActive(consent: ConsentGrant, now: Date): boolean {
  return !consent.revokedAt && consent.expiresAt.getTime() > now.getTime();
}

export function createConsentGrant(input: {
  userId: string;
  providerId: string;
  days?: number;
  now: Date;
}): ConsentGrant {
  const days = input.days ?? DEFAULT_CONSENT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_CONSENT_DAYS) {
    throw new InvalidConsentError(
      `Consent duration must be 1-${MAX_CONSENT_DAYS} days`,
    );
  }
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    providerId: input.providerId,
    grantedAt: input.now,
    expiresAt: new Date(input.now.getTime() + days * 86_400_000),
    revokedAt: null,
  };
}

export interface ConsentGrantRepository {
  findById(id: string): Promise<ConsentGrant | null>;
  findByUserId(userId: string): Promise<ConsentGrant[]>;
  insert(consent: ConsentGrant): Promise<void>;
  update(consent: ConsentGrant): Promise<void>;
  /**
   * Atomically revokes every non-revoked grant (active or merely expired)
   * for the consent's user and provider, then inserts `consent`. Concurrent
   * calls leave exactly one active grant.
   */
  replaceActive(consent: ConsentGrant, now: Date): Promise<void>;
}
