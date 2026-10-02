import {
  purgeExpired,
  type PurgeResult,
  type RetentionPolicy,
} from "@pointup/core";

import type { WorkerContainer } from "../container";
import type { WorkerEnv } from "../env";

/** Retention policy derived from the validated worker environment. */
export function retentionPolicy(env: WorkerEnv): RetentionPolicy {
  return {
    outboxRetentionDays: env.OUTBOX_RETENTION_DAYS,
    activityRetentionDays: env.ACTIVITY_RETENTION_DAYS,
    // Not configurable on purpose: short-lived credentials/consents.
    accessTokenRetentionDays: 90,
    consentRetentionDays: 365,
    batchSize: env.PURGE_BATCH_SIZE,
    maxRowsPerRun: env.PURGE_MAX_ROWS_PER_RUN,
  };
}

/**
 * Scheduled job: delete expired rows in bounded batches (see
 * `infrastructure/retention/retention.ts` for exactly what is and is not
 * purged). Safe with several workers (`FOR UPDATE SKIP LOCKED`). Emits one
 * structured log line with per-target counts; throws if any target failed so a
 * one-shot run exits non-zero, after the other targets have been purged.
 */
export async function purge(
  container: Pick<WorkerContainer, "retention">,
  env: WorkerEnv,
  write: (line: string) => void = (line) => console.info(line),
  now: Date = new Date(),
): Promise<PurgeResult> {
  const result = await purgeExpired(container.retention, retentionPolicy(env), now);
  const failed = result.targets.filter((t) => t.error);
  write(
    JSON.stringify({
      level: failed.length ? "error" : "info",
      msg: "retention_purge",
      deleted: result.deleted,
      durationMs: result.durationMs,
      targets: Object.fromEntries(
        result.targets.map((t) => [
          t.target,
          {
            deleted: t.deleted,
            batches: t.batches,
            capped: t.capped,
            cutoff: t.cutoff,
            ...(t.error ? { failed: true } : {}),
          },
        ]),
      ),
    }),
  );
  if (failed.length) {
    throw new Error(
      `purge failed for: ${failed.map((t) => t.target).join(", ")}`,
    );
  }
  return result;
}
