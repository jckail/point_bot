import { InvalidAwardWatchError, InvalidScrapeUrlError } from "../errors";

/**
 * A watched award/deal page. The worker re-scrapes it on a schedule and
 * notifies the user when a redemption at or above their cents-per-point
 * threshold appears — and again only when the best seen value improves, so
 * a standing good deal doesn't ping every day.
 */
export interface AwardWatch {
  readonly id: string;
  readonly userId: string;
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
  readonly userId: string;
  readonly url: string;
  readonly label: string;
  readonly minCentsPerPoint: number;
  readonly id?: string;
  readonly now?: Date;
}

const MAX_LABEL_LENGTH = 120;
const MAX_CENTS_PER_POINT = 100;

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
  if (
    !Number.isFinite(input.minCentsPerPoint) ||
    input.minCentsPerPoint <= 0 ||
    input.minCentsPerPoint > MAX_CENTS_PER_POINT
  ) {
    throw new InvalidAwardWatchError(
      `Threshold must be greater than 0 and at most ${MAX_CENTS_PER_POINT} cents per point`,
    );
  }

  const now = input.now ?? new Date();
  return {
    id: input.id ?? crypto.randomUUID(),
    userId: input.userId,
    url: assertHttpUrl(input.url.trim()),
    label,
    minCentsPerPoint: input.minCentsPerPoint,
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
  return {
    ...watch,
    bestSeenCentsPerPoint:
      outcome.bestRealizedCpp !== null &&
      (watch.bestSeenCentsPerPoint === null ||
        outcome.bestRealizedCpp > watch.bestSeenCentsPerPoint)
        ? outcome.bestRealizedCpp
        : watch.bestSeenCentsPerPoint,
    lastCheckedAt: outcome.now,
    lastNotifiedAt: outcome.notified ? outcome.now : watch.lastNotifiedAt,
    updatedAt: outcome.now,
  };
}

export interface AwardWatchRepository {
  findById(id: string): Promise<AwardWatch | null>;
  findByUserId(userId: string): Promise<AwardWatch[]>;
  /** Every watch across all users — the worker's check loop. */
  findAll(): Promise<AwardWatch[]>;
  insert(watch: AwardWatch): Promise<void>;
  update(watch: AwardWatch): Promise<void>;
  delete(id: string): Promise<void>;
}
