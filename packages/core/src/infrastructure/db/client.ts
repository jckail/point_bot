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
  const client = postgres(connectionString);
  return drizzle(client, { schema });
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
