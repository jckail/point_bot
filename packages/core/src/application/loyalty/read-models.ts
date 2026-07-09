import type { BalanceSource } from "../../domain/loyalty/balance-snapshot";
import type { ProviderKind } from "../../domain/loyalty/provider";
import type { BalanceTrend } from "./balance-trend";

/**
 * Read models returned by use cases. These are plain, serializable shapes:
 * the HTTP layer maps them onto wire DTOs (see `contracts/`), and other
 * in-process consumers (jobs, CLI tools) can use them directly.
 */

export interface ProviderReadModel {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly pointsCurrency: string;
  /** Editorial estimate of one point's redemption value, in US cents. */
  readonly estimatedCentsPerPoint: number;
  /** Months of inactivity before expiry; null if the program never expires. */
  readonly inactivityExpiryMonths: number | null;
}

export interface BalanceReadModel {
  readonly points: number;
  readonly source: BalanceSource;
  readonly capturedAt: Date;
}

export interface LoyaltyAccountReadModel {
  readonly id: string;
  readonly provider: ProviderReadModel;
  readonly membershipNumber: string;
  readonly hasStoredCredential: boolean;
  readonly latestBalance: BalanceReadModel | null;
  /** Approximate USD value of the latest balance, in whole cents. */
  readonly estimatedValueCents: number;
  /** Change vs. previous / 30-day / 90-day baselines. */
  readonly trend: BalanceTrend;
  /** Projected inactivity expiry; null when the program does not expire. */
  readonly expiresAt: Date | null;
  /**
   * Days until expiry (negative if already past). Null when there is no
   * expiry date.
   */
  readonly daysUntilExpiry: number | null;
  readonly notes: string | null;
  readonly tags: readonly string[];
  readonly pinnedAt: Date | null;
  readonly createdAt: Date;
}

export interface ActivityEventReadModel {
  readonly id: string;
  readonly type: import("../../domain/loyalty/activity").ActivityType;
  readonly accountId: string | null;
  readonly providerId: string | null;
  readonly summary: string;
  readonly occurredAt: Date;
}
