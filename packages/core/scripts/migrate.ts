import { runLockedMigrations } from "../src/infrastructure/db/migrations";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL is required.");
  process.exitCode = 1;
} else {
  try {
    await runLockedMigrations(databaseUrl, {
      migrationsFolder: process.env.MIGRATIONS_DIR ?? "./drizzle",
    });
    console.info("[migrate] done");
  } catch {
    // Provider exceptions can contain connection details or SQL parameters.
    console.error("[migrate] failed; inspect database and migration task status.");
    process.exitCode = 1;
  }
}
