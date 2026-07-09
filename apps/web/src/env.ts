import { composeDatabaseUrl } from "@pointup/core";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Prefer an explicit DATABASE_URL (local dev, docker-compose). On AWS, ECS
 * injects the individual fields of the RDS-managed secret (DB_HOST, DB_USER,
 * ...) and the URL is composed here.
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

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.url(),
    // Clerk user management (https://clerk.com).
    CLERK_SECRET_KEY: z.string().min(1),
    // Optional server-side credential vault (1Password Connect).
    OP_CONNECT_HOST: z.url().optional(),
    OP_CONNECT_TOKEN: z.string().min(1).optional(),
    // PointUp Assistant provider selection. "bedrock" uses AWS Bedrock
    // (Claude via the Converse API, credentials from the task role); anything
    // else falls back to the OpenAI-compatible path, then the heuristic.
    LLM_PROVIDER: z.enum(["bedrock", "openai"]).optional(),
    // Optional OpenAI-compatible LLM for PointUp Assistant.
    LLM_API_KEY: z.string().min(1).optional(),
    LLM_MODEL: z.string().min(1).optional(),
    LLM_BASE_URL: z.url().optional(),
    // AWS Bedrock assistant. BEDROCK_MODEL_ID is a region-/profile-prefixed
    // model or inference-profile id and must be verified in-account.
    BEDROCK_MODEL_ID: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).optional(),
    // Optional Firecrawl for deal / award-chart scraping.
    FIRECRAWL_API_KEY: z.string().min(1).optional(),
    FIRECRAWL_BASE_URL: z.url().optional(),
    // Optional loyalty-data aggregator for real balance syncs.
    AGGREGATOR_API_URL: z.url().optional(),
    AGGREGATOR_API_KEY: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: getDatabaseUrl(),
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    OP_CONNECT_HOST: process.env.OP_CONNECT_HOST,
    OP_CONNECT_TOKEN: process.env.OP_CONNECT_TOKEN,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID,
    AWS_REGION: process.env.AWS_REGION,
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
    FIRECRAWL_BASE_URL: process.env.FIRECRAWL_BASE_URL,
    AGGREGATOR_API_URL: process.env.AGGREGATOR_API_URL,
    AGGREGATOR_API_KEY: process.env.AGGREGATOR_API_KEY,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
