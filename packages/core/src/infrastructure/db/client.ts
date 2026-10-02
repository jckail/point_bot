import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle database handle. The connection string is injected by
 * the composition root of whichever process hosts the core (web app, worker,
 * migration task), keeping this package free of environment coupling.
 */
export function createDb(connectionString: string, pool: DbPoolOptions = {}) {
  return drizzle(
    postgres(connectionString, {
      ...postgresOptionsFor(connectionString),
      ...poolOptionsFor(pool),
    }),
    { schema },
  );
}

/** Connection pool sizing; see docs/performance.md for how to choose. */
export interface DbPoolOptions {
  /** Max connections this process opens. Default 10 (postgres.js default). */
  readonly max?: number;
  /** Seconds an idle connection is kept before closing. Default 30. */
  readonly idleTimeoutSeconds?: number;
  /** Seconds to wait for a new connection. Default 10 (postgres.js: 30). */
  readonly connectTimeoutSeconds?: number;
}

/**
 * Defaults differ from postgres.js in two deliberate ways: idle connections
 * close after 30s (the library keeps them forever, which pins server slots on
 * scaled-out-then-idle instances and fights PgBouncer/RDS Proxy), and a dead
 * database fails a request after 10s instead of 30s.
 */
export function poolOptionsFor(
  pool: DbPoolOptions,
): postgres.Options<Record<string, never>> {
  const positive = (n: number | undefined, fallback: number) =>
    n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  return {
    max: positive(pool.max, 10),
    idle_timeout: positive(pool.idleTimeoutSeconds, 30),
    connect_timeout: positive(pool.connectTimeoutSeconds, 10),
  };
}

/**
 * Connection tuning derived from the URL, so the same code runs against local
 * Docker Postgres, AWS RDS, and Supabase without per-host configuration.
 *
 * Transaction pooling (PgBouncer on its default port 6432, the Supabase pooler
 * on 6543, or `?pgbouncer=true`) disables prepared statements.
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
  if (
    url.port === "6543" ||
    url.port === "6432" ||
    url.searchParams.get("pgbouncer") === "true"
  ) {
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

/** Readiness probe: resolves when the database answers a trivial query. */
export async function pingDb(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
