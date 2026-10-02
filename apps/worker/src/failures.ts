import { randomUUID } from "node:crypto";

import { isErrorCode } from "@pointup/core/contracts";

const JOBS = new Set(["sync", "digest", "alerts", "watch", "outbox", "purge", "migrate", "bootstrap", "loop"]);
// Exception text and arbitrary metadata (including incoming request IDs) are
// never inspected or serialized. Codes use the existing closed public catalog.

export type FailureCategory =
  | "job_failed" | "scheduled_job_failed" | "chat_delivery_failed"
  | "directory_lookup_failed" | "email_delivery_failed"
  | "sync_account_failed" | "outbox_dead_letter";

export function boundedJob(job: unknown): string {
  return typeof job === "string" && JOBS.has(job) ? job : "unknown";
}

export function reportFailure(
  category: FailureCategory,
  job: unknown,
  error?: unknown,
): void {
  let code: string | undefined;
  try {
    // Never invoke an exception's getter/toJSON/toString, even for diagnostics.
    const candidate = error !== null && typeof error === "object"
      ? Object.getOwnPropertyDescriptor(error, "code")?.value as unknown
      : undefined;
    if (isErrorCode(candidate)) code = candidate;
  } catch { /* Proxies and hostile exceptions cannot break the failure path. */ }
  try {
    console.error(JSON.stringify({
      level: "error", category, job: boundedJob(job), failureRef: randomUUID(),
      ...(code ? { code } : {}),
    }));
  } catch { /* Reporting must not change exits, retries, or delivery. */ }
}

/** Shared terminal path: diagnostic failures never serialize the thrown value. */
export async function finishWorkerJob(
  run: () => Promise<void>,
  job: unknown,
  exit: (status: number) => void = (status) => { process.exit(status); },
): Promise<void> {
  let status = 0;
  try { await run(); }
  catch (error: unknown) {
    reportFailure("job_failed", job, error);
    status = 1;
  }
  exit(status);
}
