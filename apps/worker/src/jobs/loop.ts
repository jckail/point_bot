import type { WorkerEnv } from "../env";

export interface ScheduledTask {
  readonly name: string;
  readonly everyMs: number;
  readonly run: () => Promise<void>;
  /** Skip the per-run log line (for high-frequency tasks). */
  readonly quiet?: boolean;
}

/**
 * Minimal in-process scheduler for the local stack (and small single-replica
 * deployments): runs each task every `everyMs` after an initial delay, never
 * overlapping a task with itself, and stops cleanly on SIGTERM/SIGINT.
 * Production schedules the same jobs externally (EventBridge/cron) - the job
 * functions are unchanged either way.
 */
export function runLoop(
  tasks: readonly ScheduledTask[],
  options: { readonly initialDelayMs?: number } = {},
): Promise<void> {
  return new Promise((resolve) => {
    const timers = new Set<NodeJS.Timeout>();
    const running = new Set<string>();
    let stopping = false;

    const schedule = (task: ScheduledTask, delay: number) => {
      if (stopping) return;
      const timer = setTimeout(async () => {
        timers.delete(timer);
        if (!running.has(task.name)) {
          running.add(task.name);
          try {
            if (!task.quiet) console.info(`[loop] running ${task.name}`);
            await task.run();
          } catch (error) {
            console.error(`[loop] ${task.name} failed`, error);
          } finally {
            running.delete(task.name);
          }
        }
        if (running.size === 0 && stopping) resolve();
        schedule(task, task.everyMs);
      }, delay);
      timers.add(timer);
    };

    const stop = (signal: string) => {
      if (stopping) return;
      stopping = true;
      console.info(`[loop] ${signal} received, stopping`);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      // Let an in-flight task finish; resolve immediately when idle.
      if (running.size === 0) resolve();
      else {
        const poll = setInterval(() => {
          if (running.size === 0) {
            clearInterval(poll);
            resolve();
          }
        }, 200);
      }
    };
    process.once("SIGTERM", () => stop("SIGTERM"));
    process.once("SIGINT", () => stop("SIGINT"));

    for (const task of tasks) {
      schedule(task, options.initialDelayMs ?? task.everyMs);
    }
    console.info(
      `[loop] scheduled: ${tasks.map((t) => `${t.name} every ${t.everyMs < 60_000 ? `${Math.round(t.everyMs / 1000)}s` : `${Math.round(t.everyMs / 60_000)}m`}`).join(", ")}`,
    );
  });
}

export function minutes(env: WorkerEnv, key: "WORKER_SYNC_INTERVAL_MINUTES" | "WORKER_DIGEST_INTERVAL_MINUTES"): number {
  return env[key] * 60_000;
}
