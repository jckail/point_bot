import { AUTH_PROVIDERS, composeDatabaseUrl } from "@pointup/core";
import { z } from "zod";

export const MAILER_KINDS = ["ses", "smtp", "console"] as const;
export type MailerKind = (typeof MAILER_KINDS)[number];

/**
 * Prefer an explicit DATABASE_URL (local dev, docker-compose). On AWS, ECS
 * injects the individual fields of the RDS-managed secret and the URL is
 * composed here - same convention as the web app.
 */
function getDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (DB_HOST && DB_USER && DB_PASSWORD && DB_NAME) {
    return composeDatabaseUrl({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
    });
  }

  return undefined;
}

const envSchema = z.object({
  DATABASE_URL: z.url(),

  NODE_ENV: z.string().optional(),

  /**
   * Bootstrap job (local stack only). AUTH_PROVIDER=dev enables demo seeding
   * and dev-token minting; the same production guard as the web app applies.
   */
  AUTH_PROVIDER: z.enum(AUTH_PROVIDERS).default("clerk"),
  DEV_USER_ID: z.string().min(1).default("dev-user"),
  ALLOW_INSECURE_DEV_AUTH: z.string().optional(),
  DEV_AUTH_HOST_IS_LOOPBACK_ONLY: z.string().optional(),
  /** Deterministic personal access token to mint for the dev user (pu_...). */
  POINTUP_DEV_TOKEN: z.string().min(1).optional(),
  /** Public URLs printed in the connection snippets. */
  PUBLIC_WEB_URL: z.url().default("http://localhost:3000"),
  PUBLIC_MCP_URL: z.url().default("http://localhost:8787/mcp"),

  /** `loop` job cadence (minutes between syncs / digests). */
  WORKER_SYNC_INTERVAL_MINUTES: z.coerce.number().positive().default(360),
  WORKER_DIGEST_INTERVAL_MINUTES: z.coerce.number().positive().default(10080),

  /** Domain-event outbox dispatcher (`outbox` job / loop task). */
  WORKER_OUTBOX_INTERVAL_SECONDS: z.coerce.number().positive().default(10),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  /** Delivery attempts before an event is dead-lettered. */
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),

  /**
   * Retention (`purge` job / loop task). Processed outbox rows and activity
   * events older than these are deleted in bounded batches; dead-lettered
   * outbox rows, balance snapshots and agent observations are never purged.
   */
  WORKER_PURGE_INTERVAL_SECONDS: z.coerce.number().positive().default(3600),
  OUTBOX_RETENTION_DAYS: z.coerce.number().positive().default(14),
  ACTIVITY_RETENTION_DAYS: z.coerce.number().positive().default(365),
  /** Rows per DELETE statement and per-target cap per run. */
  PURGE_BATCH_SIZE: z.coerce.number().int().positive().default(1000),
  PURGE_MAX_ROWS_PER_RUN: z.coerce.number().int().positive().default(50000),

  /**
   * Email delivery backend:
   * - "ses": AWS SES (task role must allow ses:SendEmail)
   * - "smtp": any SMTP endpoint - Mailpit in local development
   * - "console": log emails instead of sending (default)
   */
  MAILER: z.enum(MAILER_KINDS).default("console"),
  /** SMTP endpoint for MAILER=smtp, e.g. smtp://mailpit:1025 */
  SMTP_URL: z.url().optional(),
  /** Verified sender address for digests (required for ses/smtp). */
  DIGEST_FROM_EMAIL: z.email().optional(),

  /** Clerk secret key; used to resolve user email addresses. */
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  /** Dev fallback: send every digest to this address instead of Clerk lookup. */
  DIGEST_RECIPIENT_OVERRIDE: z.email().optional(),

  /** Optional server-side credential vault (1Password Connect). */
  OP_CONNECT_HOST: z.url().optional(),
  OP_CONNECT_TOKEN: z.string().min(1).optional(),

  /** Optional loyalty-data aggregator for real balance syncs. */
  AGGREGATOR_API_URL: z.url().optional(),
  AGGREGATOR_API_KEY: z.string().min(1).optional(),

  /** Optional Firecrawl for the award-watch scrape job (falls back to stub). */
  FIRECRAWL_API_KEY: z.string().min(1).optional(),
  FIRECRAWL_BASE_URL: z.url().optional(),

  /** Optional chat digest delivery — Slack / Discord incoming webhooks. */
  SLACK_WEBHOOK_URL: z.url().optional(),
  DISCORD_WEBHOOK_URL: z.url().optional(),

  /** Proactive-alerts thresholds (the `alerts` job); core defaults apply. */
  ALERT_EXPIRY_WARNING_DAYS: z.coerce.number().int().positive().optional(),
  ALERT_BIG_CHANGE_PERCENT: z.coerce.number().positive().optional(),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(): WorkerEnv {
  return envSchema.parse({
    ...process.env,
    DATABASE_URL: getDatabaseUrl(),
  });
}
