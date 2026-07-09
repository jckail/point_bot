import { createContainer } from "./container";
import { loadEnv } from "./env";
import { runMigrations } from "./jobs/migrate";
import { sendDigests } from "./jobs/send-digests";
import { syncAllUsers } from "./jobs/sync-all-users";
import { createMailer } from "./mailers";
import { createUserDirectory } from "./user-directory";

const JOBS = ["sync", "digest", "migrate"] as const;
type Job = (typeof JOBS)[number];

async function main(): Promise<void> {
  const job = process.argv[2] as Job | undefined;
  if (!job || !JOBS.includes(job)) {
    console.error(`Usage: worker <${JOBS.join("|")}>`);
    process.exitCode = 2;
    return;
  }

  const env = loadEnv();

  if (job === "migrate") {
    await runMigrations(env.DATABASE_URL);
    return;
  }

  const container = createContainer(env);
  if (job === "sync") {
    await syncAllUsers(container);
  } else {
    await sendDigests(container, createUserDirectory(env), createMailer(env));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[worker] job failed", error);
    process.exit(1);
  });
