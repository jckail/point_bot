import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle database handle. The connection string is injected by
 * the composition root of whichever process hosts the core (web app, worker,
 * migration task), keeping this package free of environment coupling.
 */
export function createDb(connectionString: string) {
  return drizzle(postgres(connectionString, postgresOptionsFor(connectionString)), {
    schema,
  });
}

/**
 * Connection tuning derived from the URL, so the same code runs against local
 * Docker Postgres, AWS RDS, and Supabase without per-host configuration.
 *
 * Supabase specifics:
 * - Hosted databases require TLS.
 * - The transaction-mode pooler (port 6543) does not support prepared
 *   statements, which postgres.js uses by default.
 */
export function postgresOptionsFor(
  connectionString: string,
): postgres.Options<Record<string, never>> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return {};
  }
  const isSupabase =
    url.hostname.endsWith(".supabase.co") ||
    url.hostname.endsWith(".supabase.com");
  const options: postgres.Options<Record<string, never>> = {};
  if (isSupabase && !url.searchParams.has("sslmode")) options.ssl = "require";
  if (url.port === "6543" || url.searchParams.get("pgbouncer") === "true") {
    options.prepare = false;
  }
  return options;
}

export interface DatabaseUrlParts {
  readonly host: string;
  readonly port?: string | number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/**
 * Builds a PostgreSQL connection URL from discrete parts - the shape AWS
 * injects from the RDS-managed secret (DB_HOST, DB_USER, ...). Hosts read
 * their own environment and call this; the core still never touches env.
 */
export function composeDatabaseUrl(parts: DatabaseUrlParts): string {
  const user = encodeURIComponent(parts.user);
  const password = encodeURIComponent(parts.password);
  return `postgresql://${user}:${password}@${parts.host}:${parts.port ?? 5432}/${parts.database}`;
}
