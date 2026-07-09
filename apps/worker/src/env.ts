import { composeDatabaseUrl } from "@pointup/core";
import { z } from "zod";

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

  /**
   * Email delivery backend:
   * - "ses": AWS SES (task role must allow ses:SendEmail)
   * - "smtp": any SMTP endpoint - Mailpit in local development
   * - "console": log emails instead of sending (default)
   */
  MAILER: z.enum(["ses", "smtp", "console"]).default("console"),
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
