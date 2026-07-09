import type { BalanceSnapshot } from "../../domain/loyalty/balance-snapshot";
import type { BalanceTrendContext } from "../../domain/loyalty/repositories";

export interface BalanceDelta {
  /** Absolute change in points (latest − baseline). */
  readonly points: number;
  /** Relative change as a fraction of the baseline (null when baseline is 0). */
  readonly percent: number | null;
}

export interface BalanceTrend {
  /** Change vs. the immediately previous snapshot. */
  readonly sincePrevious: BalanceDelta | null;
  /** Change vs. the newest reading on or before 30 days ago. */
  readonly since30Days: BalanceDelta | null;
  /** Change vs. the newest reading on or before 90 days ago. */
  readonly since90Days: BalanceDelta | null;
}

export function computeDelta(
  latest: number,
  baseline: number,
): BalanceDelta {
  const points = latest - baseline;
  return {
    points,
    percent: baseline === 0 ? null : points / baseline,
  };
}

export function computeBalanceTrend(
  context: BalanceTrendContext,
): BalanceTrend {
  const latestPoints = context.latest?.points;
  if (latestPoints === undefined) {
    return { sincePrevious: null, since30Days: null, since90Days: null };
  }

  return {
    sincePrevious: context.previous
      ? computeDelta(latestPoints, context.previous.points)
      : null,
    since30Days: context.asOf30Days
      ? computeDelta(latestPoints, context.asOf30Days.points)
      : null,
    since90Days: context.asOf90Days
      ? computeDelta(latestPoints, context.asOf90Days.points)
      : null,
  };
}

export function emptyBalanceTrend(): BalanceTrend {
  return { sincePrevious: null, since30Days: null, since90Days: null };
}

/** Pure helper used by both the Drizzle adapter and the in-memory fake. */
export function buildTrendContext(
  snapshotsNewestFirst: readonly BalanceSnapshot[],
  now: Date,
): BalanceTrendContext {
  const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const latest = snapshotsNewestFirst[0] ?? null;
  const previous = snapshotsNewestFirst[1] ?? null;
  const asOf30Days =
    snapshotsNewestFirst.find((s) => s.capturedAt <= cutoff30) ?? null;
  const asOf90Days =
    snapshotsNewestFirst.find((s) => s.capturedAt <= cutoff90) ?? null;

  return { latest, previous, asOf30Days, asOf90Days };
}
