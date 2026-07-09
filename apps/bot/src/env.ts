import { composeDatabaseUrl } from "@pointup/core";
import { z } from "zod";

/** Same DATABASE_URL resolution as the web app and worker. */
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
  PORT: z.coerce.number().int().positive().default(8080),

  /** Slack request signing secret; when unset, the Slack route is disabled. */
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),

  /** Discord app Ed25519 public key (hex); when unset, the Discord route is off. */
  DISCORD_PUBLIC_KEY: z.string().min(1).optional(),
  /** Discord application id; enables deferred replies for slow commands. */
  DISCORD_APP_ID: z.string().min(1).optional(),

  /**
   * Self-hosted / personal mode: run every command as this app user id,
   * ignoring the platform-supplied identity. Leave unset in multi-user setups,
   * where the platform user id is used as the app user id.
   */
  BOT_DEFAULT_USER_ID: z.string().min(1).optional(),

  // Assistant provider selection — same precedence as the web app.
  LLM_PROVIDER: z.enum(["bedrock", "openai"]).optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).optional(),
  LLM_BASE_URL: z.url().optional(),
  BEDROCK_MODEL_ID: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
});

export type BotEnv = z.infer<typeof envSchema>;

export function loadEnv(): BotEnv {
  return envSchema.parse({ ...process.env, DATABASE_URL: getDatabaseUrl() });
}
