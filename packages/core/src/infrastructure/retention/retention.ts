/**
 * Data retention: bounded, resumable purges of data that is only useful for a
 * limited time. Pure orchestration over a `RetentionStore` port; the Postgres
 * implementation lives in `drizzle-retention-repository.ts`.
 *
 * What is purged (and what never is) is a product/audit decision, so it is
 * spelled out here and mirrored in docs/events.md:
 *
 * - processed outbox rows older than `outboxRetentionDays` (dead-lettered rows
 *   are KEPT for inspection)
 * - `activity_event` rows older than `activityRetentionDays`
 * - access tokens expired or revoked more than `accessTokenRetentionDays` ago
 * - consent grants expired or revoked more than `consentRetentionDays` ago
 *
 * NEVER touched: `balance_snapshot` (the history is the product) and
 * `agent_observation` (the audit trail of agent write-backs).
 */

export const RETENTION_TARGETS = [
  "outbox",
  "activity",
  "access_tokens",
  "consents",
] as const;
export type RetentionTarget = (typeof RETENTION_TARGETS)[number];

export interface RetentionPolicy {
  readonly outboxRetentionDays: number;
  readonly activityRetentionDays: number;
  readonly accessTokenRetentionDays: number;
  readonly consentRetentionDays: number;
  /** Rows deleted per statement (one short transaction each). */
  readonly batchSize: number;
  /** Max rows deleted per target in one run; the rest waits for the next run. */
  readonly maxRowsPerRun: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  outboxRetentionDays: 14,
  activityRetentionDays: 365,
  accessTokenRetentionDays: 90,
  consentRetentionDays: 365,
  batchSize: 1_000,
  maxRowsPerRun: 50_000,
};

export interface RetentionStore {
  /**
   * Deletes at most `limit` expired rows of `target` older than `cutoff` and
   * returns how many it deleted. Must be safe to run concurrently from several
   * workers (no row is deleted twice, none blocks another worker).
   */
  purgeBatch(target: RetentionTarget, cutoff: Date, limit: number): Promise<number>;
}

export interface TargetPurgeResult {
  readonly target: RetentionTarget;
  readonly cutoff: string;
  readonly deleted: number;
  readonly batches: number;
  /** True when the per-run cap stopped the purge while more rows may remain. */
  readonly capped: boolean;
  readonly error?: string;
}

export interface PurgeResult {
  readonly targets: readonly TargetPurgeResult[];
  readonly deleted: number;
  readonly durationMs: number;
}

const DAY_MS = 86_400_000;

export function retentionCutoffs(
  policy: RetentionPolicy,
  now: Date,
): Record<RetentionTarget, Date> {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    outbox: before(policy.outboxRetentionDays),
    activity: before(policy.activityRetentionDays),
    access_tokens: before(policy.accessTokenRetentionDays),
    consents: before(policy.consentRetentionDays),
  };
}

/**
 * Runs every purge in bounded batches. A failing target is recorded in its
 * result and does not stop the others; the caller decides whether that is fatal.
 */
export async function purgeExpired(
  store: RetentionStore,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
  now: Date = new Date(),
  clock: () => number = () => performance.now(),
): Promise<PurgeResult> {
  if (policy.batchSize < 1 || policy.maxRowsPerRun < 1) {
    throw new RangeError("batchSize and maxRowsPerRun must be positive");
  }
  const started = clock();
  const cutoffs = retentionCutoffs(policy, now);
  const targets: TargetPurgeResult[] = [];
  for (const target of RETENTION_TARGETS) {
    const cutoff = cutoffs[target];
    let deleted = 0;
    let batches = 0;
    let capped = false;
    let error: string | undefined;
    try {
      for (;;) {
        const limit = Math.min(policy.batchSize, policy.maxRowsPerRun - deleted);
        const n = await store.purgeBatch(target, cutoff, limit);
        batches += 1;
        deleted += n;
        if (n < limit) break; // drained
        if (deleted >= policy.maxRowsPerRun) {
          capped = true;
          break;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    targets.push({
      target,
      cutoff: cutoff.toISOString(),
      deleted,
      batches,
      capped,
      ...(error ? { error } : {}),
    });
  }
  return {
    targets,
    deleted: targets.reduce((sum, t) => sum + t.deleted, 0),
    durationMs: Math.round((clock() - started) * 100) / 100,
  };
}
