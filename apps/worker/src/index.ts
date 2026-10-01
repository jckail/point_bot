import { assertNever, isOneOf } from "@pointup/core";

import { createContainer } from "./container";
import { loadEnv } from "./env";
import { checkWatches } from "./jobs/check-watches";
import { bootstrap } from "./jobs/bootstrap";
import { minutes, runLoop } from "./jobs/loop";
import { runMigrations } from "./jobs/migrate";
import { processOutbox } from "./jobs/outbox";
import { purge } from "./jobs/purge";
import { sendAlerts } from "./jobs/send-alerts";
import { sendDigests } from "./jobs/send-digests";
import { syncAllUsers } from "./jobs/sync-all-users";
import { createMailer } from "./mailers";
import { createNotifier } from "./notifiers";
import { outboxOptions } from "./jobs/outbox";
import { createUserDirectory } from "./user-directory";

const JOBS = [
  "sync",
  "digest",
  "alerts",
  "watch",
  "outbox",
  "purge",
  "migrate",
  "bootstrap",
  "loop",
] as const;

async function main(): Promise<void> {
  const job = process.argv[2];
  if (!isOneOf(JOBS, job)) {
    console.error(`Usage: worker <${JOBS.join("|")}>`);
    process.exitCode = 2;
    return;
  }

  const env = loadEnv();

  if (job === "migrate") {
    await runMigrations(env.DATABASE_URL);
    return;
  }

  if (job === "bootstrap") {
    await bootstrap(env, () => createContainer(env));
    return;
  }

  const container = createContainer(env);
  if (job === "loop") {
    await runLoop([
      {
        name: "outbox",
        everyMs: env.WORKER_OUTBOX_INTERVAL_SECONDS * 1000,
        quiet: true,
        run: async () => {
          await processOutbox(container, createNotifier(env), outboxOptions(env));
        },
      },
      {
        name: "purge",
        everyMs: env.WORKER_PURGE_INTERVAL_SECONDS * 1000,
        run: async () => {
          await purge(container, env);
        },
      },
      {
        name: "sync",
        everyMs: minutes(env, "WORKER_SYNC_INTERVAL_MINUTES"),
        run: () => syncAllUsers(container),
      },
      {
        name: "digest",
        everyMs: minutes(env, "WORKER_DIGEST_INTERVAL_MINUTES"),
        run: () =>
          sendDigests(
            container,
            createUserDirectory(env),
            createMailer(env),
            createNotifier(env),
          ),
      },
    ]);
    return;
  }
  switch (job) {
    case "purge":
      await purge(container, env);
      return;
    case "outbox":
      await processOutbox(container, createNotifier(env), outboxOptions(env), {
        drain: true,
      });
      return;
    case "sync":
      await syncAllUsers(container);
      return;
    case "watch":
      await checkWatches(
        container,
        createUserDirectory(env),
        createMailer(env),
        createNotifier(env),
      );
      return;
    case "alerts":
      await sendAlerts(
        container,
        createUserDirectory(env),
        createMailer(env),
        createNotifier(env),
        {
          ...(env.ALERT_EXPIRY_WARNING_DAYS !== undefined
            ? { expiryWarningDays: env.ALERT_EXPIRY_WARNING_DAYS }
            : {}),
          ...(env.ALERT_BIG_CHANGE_PERCENT !== undefined
            ? { bigChangePercent: env.ALERT_BIG_CHANGE_PERCENT }
            : {}),
        },
      );
      return;
    case "digest":
      await sendDigests(
        container,
        createUserDirectory(env),
        createMailer(env),
        createNotifier(env),
      );
      return;
    default:
      return assertNever(job);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[worker] job failed", error);
    process.exit(1);
  });
