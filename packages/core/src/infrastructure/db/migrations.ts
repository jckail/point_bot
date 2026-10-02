import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as applicationSchema from "./schema";
import type { MigrationConfig } from "drizzle-orm/migrator";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";

import { postgresOptionsFor } from "./client";

/** One key shared by every PointUp migration host and integration fixture. */
export const MIGRATION_LOCK_KEY = 846795951;

/** Session advisory locks require a direct or session-pooled connection. */
export function assertMigrationConnectionString(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Migrations require a valid PostgreSQL connection URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Migrations require a valid PostgreSQL connection URL.");
  }
  if (url.port === "6432" || url.port === "6543" || url.searchParams.getAll("pgbouncer").includes("true")) {
    throw new Error("Locked migrations require a direct PostgreSQL connection or session pooler. Supply its connection URL instead of a transaction pooler.");
  }
}

export interface MigrationManifest {
  readonly manifestSha256: string;
  readonly files: readonly { path: string; sha256: string }[];
  readonly entries: readonly { when: number; hash: string }[];
}
export interface MigrationAttestation {
  readonly component: "pointup_migrations";
  readonly event: "journal_verified";
  readonly manifestSha256: string;
  readonly migrationCount: number;
  /** Bounded managed table/column/check/FK/trigger presence gate succeeded. */
  readonly schemaVerified?: true;
}
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Digest version 1 hashes raw journal/SQL bytes, in managed journal order. */
export async function readMigrationManifest(folder: string): Promise<MigrationManifest> {
  try {
    const journalBytes = await readFile(join(folder, "meta/_journal.json"));
    const journal = JSON.parse(journalBytes.toString("utf8")) as {
      version?: unknown; dialect?: unknown; entries?: unknown;
    };
    if (journal.version !== "7" || journal.dialect !== "postgresql" || !Array.isArray(journal.entries) || !journal.entries.length) throw new Error();
    const files = [{ path: "meta/_journal.json", sha256: sha256(journalBytes) }];
    const entries: { when: number; hash: string }[] = [];
    let previousWhen = -1;
    for (const [index, raw] of journal.entries.entries()) {
      if (!raw || typeof raw !== "object") throw new Error();
      const entry = raw as { idx?: unknown; tag?: unknown; when?: unknown; version?: unknown; breakpoints?: unknown };
      if (entry.idx !== index || entry.version !== "7" || typeof entry.tag !== "string" || !new RegExp(`^${String(index).padStart(4, "0")}_[a-zA-Z0-9_]+$`).test(entry.tag)
        || typeof entry.when !== "number" || !Number.isSafeInteger(entry.when) || entry.when <= previousWhen || typeof entry.breakpoints !== "boolean") throw new Error();
      previousWhen = entry.when;
      const path = entry.tag + ".sql";
      const bytes = await readFile(join(folder, path));
      // Invalid UTF-8 could make Drizzle's text hash differ from the raw-byte hash.
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const hash = sha256(bytes);
      files.push({ path, sha256: hash });
      entries.push({ when: entry.when, hash });
    }
    return { manifestSha256: sha256(JSON.stringify({ version: 1, files })), files, entries };
  } catch {
    // Filesystem/JSON errors can contain private host paths. Keep the boundary fixed.
    throw new Error("Managed migration manifest is missing or invalid.");
  }
}

function assertExpectedManifest(expected: string | undefined): void {
  if (expected !== undefined && !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Expected migration manifest must be a lowercase SHA-256 digest.");
}

export interface MigrationLockOptions {
  /** Maximum wait for another migration, defaults to two minutes. */
  readonly lockTimeoutMs?: number;
  /** Candidate deployment gate; omitted for ordinary local/legacy migration. */
  readonly expectedManifestSha256?: string;
  /** Explicit application schema for isolated/custom installs; defaults to public and current_schema(). */
  readonly applicationSchema?: string;
  /** Worker candidate gate; does not assert complete type/index/function equivalence. */
  readonly verifyApplicationSchema?: boolean;
  /** Called after journal attestation, while the migration advisory lock is held. */
  readonly onAttested?: (attestation: MigrationAttestation) => void | Promise<void>;
}

/** Shared entry point for CLI and worker migrations, with a dedicated pool. */
export async function runLockedMigrations(
  databaseUrl: string,
  config: MigrationConfig,
  options: MigrationLockOptions = {},
): Promise<MigrationAttestation | undefined> {
  assertMigrationConnectionString(databaseUrl);
  assertExpectedManifest(options.expectedManifestSha256);
  // One connection owns the session lock; the other serves Drizzle's journal
  // reads and transaction. Preserve host-specific TLS and statement settings.
  const client = postgres(databaseUrl, { ...postgresOptionsFor(databaseUrl), max: 2 });
  try {
    return await migrateWithLock(drizzle(client), config, options);
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * Acquire the lock before Drizzle creates or reads its journal. The reserved
 * connection holds the session lock while the migrator uses the remaining pool.
 */
export async function migrateWithLock<TSchema extends Record<string, unknown>>(
  db: PostgresJsDatabase<TSchema> & { $client: Sql },
  config: MigrationConfig,
  options: MigrationLockOptions = {},
): Promise<MigrationAttestation | undefined> {
  assertExpectedManifest(options.expectedManifestSha256);
  const client = db.$client;
  if (client.options.max < 2) {
    throw new Error("Locked migrations require a dedicated pool with at least two connections.");
  }
  const timeoutMs = options.lockTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error("Migration lock timeout must be between 1 and 300000 milliseconds.");
  }

  const lease = await client.reserve();
  let locked = false;
  let previousTimeout: string | undefined;
  try {
    const previous = await lease`SHOW lock_timeout`;
    previousTimeout = String(previous[0]?.lock_timeout ?? "0");
    await lease`SELECT set_config('lock_timeout', ${timeoutMs + "ms"}, false)`;
    await lease`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    locked = true;
    const expected = options.expectedManifestSha256;
    const manifest = expected === undefined ? undefined : await readMigrationManifest(config.migrationsFolder);
    if (manifest && manifest.manifestSha256 !== expected) throw new Error("Baked migration manifest does not match the approved candidate.");
    const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const journalName = identifier(config.migrationsSchema ?? "drizzle") + "." + identifier(config.migrationsTable ?? "__drizzle_migrations");
    const assertFreshApplicationSchema = async () => {
      // Names from managed SQL 0000–0021; unrelated Supabase public tables do
      // not imply a PointUp lineage. Empty PointUp tables still require a journal.
      const managedTables = ["balance_snapshot", "loyalty_account", "activity_event", "trip_goal", "portfolio_share",
        "user_provider_valuation", "award_watch", "user_setting", "access_token", "agent_observation", "consent_grant",
        "account_tag", "trip_goal_account", "domain_event_outbox", "transfer_bonus", "assistant_action", "trip_goal_membership_review"];
      let rows;
      try {
        rows = await lease<{ present: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind IN ('r','p','v','m','f')
            AND (CASE WHEN ${options.applicationSchema ?? null}::text IS NULL
              THEN n.nspname='public' OR n.nspname=current_schema()
              ELSE n.nspname=${options.applicationSchema ?? null}::text END)
            AND (c.relname=ANY(${managedTables}::text[]) OR left(c.relname,8)='pointup_')
        ) AS present`;
      } catch { throw new Error("Managed application schema verification failed."); }
      if (rows[0]?.present !== false) throw new Error("Managed migration journal is missing or empty for existing PointUp application tables.");
    };
    const readJournal = async (allowMissing: boolean) => {
      let exists;
      try { exists = await lease`SELECT to_regclass(${journalName}) AS journal`; }
      catch { throw new Error("Managed migration journal verification failed."); }
      if (exists[0]?.journal == null) {
        if (allowMissing) return [];
        throw new Error("Managed migration journal verification failed.");
      }
      try { return await lease.unsafe<{ hash: string; created_at: string | number }[]>(`SELECT hash, created_at FROM ${journalName} ORDER BY created_at ASC, id ASC`); }
      catch { throw new Error("Managed migration journal verification failed."); }
    };
    const verifyPhysicalSchema = async () => {
      const tables = Object.values(applicationSchema).flatMap(table => is(table, PgTable) ? [getTableConfig(table)] : []);
      let columns;
      let constraints;
      let triggers;
      try {
        const [resolved] = await lease<{ schema_name: string }[]>`SELECT COALESCE(${options.applicationSchema ?? null}::text,current_schema()) AS schema_name`;
        if (!resolved?.schema_name) throw new Error();
        const schemaName = resolved.schema_name;
        columns = await lease<{ table_name: string; column_name: string; row_security: boolean; type_name: string; not_null: boolean }[]>`
          SELECT c.relname AS table_name,a.attname AS column_name,c.relrowsecurity AS row_security,
            pg_catalog.format_type(a.atttypid,a.atttypmod) AS type_name,a.attnotnull AS not_null
          FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
          WHERE n.nspname=${schemaName} AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped`;
        constraints = await lease<{ table_name: string; name: string; type: string; validated: boolean }[]>`
          SELECT c.relname AS table_name,co.conname AS name,co.contype AS type,co.convalidated AS validated
          FROM pg_catalog.pg_constraint co JOIN pg_catalog.pg_class c ON c.oid=co.conrelid
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schemaName}`;
        triggers = await lease<{ table_name: string; name: string }[]>`
          SELECT c.relname AS table_name,t.tgname AS name
          FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=${schemaName} AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')`;
      } catch { throw new Error("Managed physical schema verification failed."); }
      const columnNames = new Set(columns.map(row => row.table_name + "." + row.column_name));
      const securedTables = new Set(columns.filter(row => row.row_security === true).map(row => row.table_name));
      const constraintNames = new Set(constraints.map(row => row.table_name + "." + row.type + "." + row.name));
      const triggerNames = new Set(triggers.map(row => row.table_name + "." + row.name));
      const cardColumn = columns.find(row => row.table_name === "loyalty_account" && row.column_name === "card_product_id");
      const cardCheck = constraints.find(row => row.table_name === "loyalty_account" && row.name === "loyalty_account_card_product_check" && row.type === "c");
      const requiredFks = [["agent_observation", "agent_observation_owned_account_fk"],
        ["trip_goal_account", "trip_goal_account_owned_goal_fk"], ["trip_goal_account", "trip_goal_account_owned_account_fk"]];
      // CHECK/FK presence deliberately accepts NOT VALID legacy constraints.
      // This is a bounded readiness contract, not full schema equivalence.
      if (cardColumn?.type_name !== "character varying(64)" || cardColumn.not_null !== false || cardCheck?.validated !== true
        || tables.some(table => !securedTables.has(table.name) || table.columns.some(column => !columnNames.has(table.name + "." + column.name))
          || table.checks.some(check => !constraintNames.has(table.name + ".c." + check.name)))
        || requiredFks.some(([table, name]) => !constraintNames.has(table + ".f." + name))
        || !triggerNames.has("trip_goal_account.trip_goal_account_derive_owner")) {
        throw new Error("Managed physical schema does not satisfy the candidate readiness contract.");
      }
    };
    const assertJournal = (rows: { hash: string; created_at: string | number }[], complete: boolean) => {
      if ((complete ? rows.length !== manifest!.entries.length : rows.length > manifest!.entries.length)
        || rows.some((row, index) => row.hash !== manifest!.entries[index]!.hash || String(row.created_at) !== String(manifest!.entries[index]!.when))) {
        throw new Error("Managed migration journal does not match the approved manifest.");
      }
    };
    // Candidate mode permits an empty prefix only for a fresh PointUp schema;
    // ordinary local/adoption migrations remain unchanged when no digest is set.
    if (manifest) {
      const prefix = await readJournal(true);
      assertJournal(prefix, false);
      if (prefix.length === 0) await assertFreshApplicationSchema();
    }
    await migrate(db, config);
    if (manifest) {
      assertJournal(await readJournal(false), true);
      if ((await readMigrationManifest(config.migrationsFolder)).manifestSha256 !== expected) throw new Error("Baked migration manifest changed during migration.");
      if (options.verifyApplicationSchema) await verifyPhysicalSchema();
      const attestation: MigrationAttestation = { ...(options.verifyApplicationSchema ? { schemaVerified: true as const } : {}), component: "pointup_migrations", event: "journal_verified", manifestSha256: manifest.manifestSha256, migrationCount: manifest.entries.length };
      await options.onAttested?.(attestation);
      return attestation;
    }
    return undefined;
  } finally {
    try {
      if (locked) await lease`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      if (previousTimeout !== undefined) {
        await lease`SELECT set_config('lock_timeout', ${previousTimeout}, false)`;
      }
    } catch (cleanupError) {
      // A session lock must never return to the pool after failed cleanup.
      // Hosts give this helper a dedicated migration client, so closing it
      // cannot interrupt application traffic and releases any surviving lock.
      await client.end({ timeout: 5 });
      throw cleanupError;
    } finally {
      lease.release();
    }
  }
}
