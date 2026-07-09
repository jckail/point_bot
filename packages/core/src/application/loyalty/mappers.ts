import type { BalanceSnapshot } from "../../domain/loyalty/balance-snapshot";
import type { LoyaltyAccount } from "../../domain/loyalty/loyalty-account";
import { getProviderOrThrow } from "../../domain/loyalty/provider";
import type { BalanceTrendContext } from "../../domain/loyalty/repositories";
import {
  computeBalanceTrend,
  emptyBalanceTrend,
  type BalanceTrend,
} from "./balance-trend";
import type {
  BalanceReadModel,
  LoyaltyAccountReadModel,
} from "./read-models";

export function toBalanceReadModel(
  snapshot: BalanceSnapshot,
): BalanceReadModel {
  return {
    points: snapshot.points,
    source: snapshot.source,
    capturedAt: snapshot.capturedAt,
  };
}

function daysUntil(expiresAt: Date | null, now: Date): number | null {
  if (!expiresAt) return null;
  return Math.ceil(
    (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );
}

export function toLoyaltyAccountReadModel(
  account: LoyaltyAccount,
  context: BalanceTrendContext | null,
  now: Date = new Date(),
  /** providerId → user override cents-per-point; applied to value when present. */
  valuationOverrides: ReadonlyMap<string, number> = new Map(),
): LoyaltyAccountReadModel {
  const provider = getProviderOrThrow(account.providerId);
  const latest = context?.latest ?? null;
  const trend: BalanceTrend = context
    ? computeBalanceTrend(context)
    : emptyBalanceTrend();

  const customCentsPerPoint = valuationOverrides.get(provider.id) ?? null;
  const effectiveCentsPerPoint =
    customCentsPerPoint ?? provider.estimatedCentsPerPoint;

  return {
    id: account.id,
    provider: {
      id: provider.id,
      kind: provider.kind,
      displayName: provider.displayName,
      pointsCurrency: provider.pointsCurrency,
      estimatedCentsPerPoint: provider.estimatedCentsPerPoint,
      inactivityExpiryMonths: provider.inactivityExpiryMonths,
    },
    membershipNumber: account.membershipNumber,
    hasStoredCredential: account.credentialRef !== null,
    latestBalance: latest ? toBalanceReadModel(latest) : null,
    // Value uses the user's override when set, else the editorial estimate.
    estimatedValueCents: latest
      ? Math.round(latest.points * effectiveCentsPerPoint)
      : 0,
    customCentsPerPoint,
    trend,
    expiresAt: account.expiresAt,
    daysUntilExpiry: daysUntil(account.expiresAt, now),
    notes: account.notes,
    tags: account.tags,
    pinnedAt: account.pinnedAt,
    createdAt: account.createdAt,
  };
}
