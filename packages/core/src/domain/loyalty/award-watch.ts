import { InvalidAwardWatchError, InvalidScrapeUrlError } from "../errors";

import { AwardWatchId, type UserId } from "../shared/ids";
/**
 * A watched award/deal page. The worker re-scrapes it on a schedule and
 * notifies the user when a redemption at or above their cents-per-point
 * threshold appears — and again only when the best seen value improves, so
 * a standing good deal doesn't ping every day.
 */
export interface AwardWatch {
  readonly id: AwardWatchId;
  readonly userId: UserId;
  /** The award-chart / deal page to re-scrape. */
  readonly url: string;
  readonly label: string;
  /** Notify when a scraped deal's realized ¢/pt reaches this value. */
  readonly minCentsPerPoint: number;
  /** Best realized ¢/pt seen so far; null until the first qualifying hit. */
  readonly bestSeenCentsPerPoint: number | null;
  readonly lastCheckedAt: Date | null;
  readonly lastNotifiedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewAwardWatch {
  readonly userId: UserId;
  readonly url: string;
  readonly label: string;
  readonly minCentsPerPoint: number;
  readonly id?: AwardWatchId;
  readonly now?: Date;
}

const MAX_LABEL_LENGTH = 120;
const MAX_CENTS_PER_POINT = 100;

/** Thresholds share the existing 100-cent cap and nearest-milli policy. */
export function normalizeAwardWatchThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_CENTS_PER_POINT) {
    throw new InvalidAwardWatchError("Threshold must be positive and at most 100 cents per point");
  }
  const milli = Math.round(value * 1000);
  if (milli < 1) throw new InvalidAwardWatchError("Threshold must round to at least one milli-cent per point");
  return milli / 1000;
}

/** Observed rates are not threshold-capped; their persisted milli value is int4. */
export function normalizeObservedCentsPerPoint(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 2_147_483_647 / 1000) {
    throw new InvalidAwardWatchError("Observed rate must fit nonnegative integer milli-cents");
  }
  return Math.round(value * 1000) / 1000;
}

function assertHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidScrapeUrlError();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidScrapeUrlError();
  }
  return parsed.toString();
}

/** Factory enforcing the entity's invariants. */
export function createAwardWatch(input: NewAwardWatch): AwardWatch {
  const label = input.label.trim();
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
    throw new InvalidAwardWatchError(
      `Label must be 1-${MAX_LABEL_LENGTH} characters`,
    );
  }
  const minCentsPerPoint = normalizeAwardWatchThreshold(input.minCentsPerPoint);

  const now = input.now ?? new Date();
  return {
    id: input.id ?? AwardWatchId.generate(),
    userId: input.userId,
    url: assertHttpUrl(input.url.trim()),
    label,
    minCentsPerPoint,
    bestSeenCentsPerPoint: null,
    lastCheckedAt: null,
    lastNotifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Pure decision: given a check's best realized ¢/pt, does this watch fire?
 * Fires when the threshold is met AND the value improves on the best already
 * seen (first qualifying hit always fires).
 */
export function shouldNotify(
  watch: AwardWatch,
  bestRealizedCpp: number | null,
): boolean {
  bestRealizedCpp = normalizeObservedCentsPerPoint(bestRealizedCpp);
  if (bestRealizedCpp === null) return false;
  if (bestRealizedCpp < watch.minCentsPerPoint) return false;
  return (
    watch.bestSeenCentsPerPoint === null ||
    bestRealizedCpp > watch.bestSeenCentsPerPoint
  );
}

/** Record a check outcome (immutably), advancing bookkeeping fields. */
export function recordCheck(
  watch: AwardWatch,
  outcome: { bestRealizedCpp: number | null; notified: boolean; now: Date },
): AwardWatch {
  const bestRealizedCpp = normalizeObservedCentsPerPoint(outcome.bestRealizedCpp);
  return {
    ...watch,
    bestSeenCentsPerPoint:
      bestRealizedCpp !== null &&
      (watch.bestSeenCentsPerPoint === null ||
        bestRealizedCpp > watch.bestSeenCentsPerPoint)
        ? bestRealizedCpp
        : watch.bestSeenCentsPerPoint,
    lastCheckedAt: outcome.now,
    lastNotifiedAt: outcome.notified ? outcome.now : watch.lastNotifiedAt,
    updatedAt: outcome.now,
  };
}

export interface AwardWatchRepository {
  findById(id: AwardWatchId): Promise<AwardWatch | null>;
  /** Lock the current row until the enclosing atomic unit of work commits. */
  lockById?(id: AwardWatchId): Promise<AwardWatch | null>;
  findByUserId(userId: UserId): Promise<AwardWatch[]>;
  /** Every watch across all users — the worker's check loop. */
  findAll(): Promise<AwardWatch[]>;
  insert(watch: AwardWatch): Promise<void>;
  update(watch: AwardWatch): Promise<void>;
  delete(id: AwardWatchId): Promise<void>;
}
