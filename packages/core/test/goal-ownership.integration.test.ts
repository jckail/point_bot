import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTripGoal } from "../src/domain/loyalty/trip-goal";
import { LoyaltyAccountId, TripGoalId, UserId } from "../src/domain/shared/ids";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";
import * as schema from "../src/infrastructure/db/schema";
import { DrizzleTripGoalRepository } from "../src/infrastructure/repositories/drizzle-loyalty-account-repository";

// Every test owns a randomized schema; no public tables or migration history.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ownedSchema = /^pointup_goal_fixture_[a-f0-9]{32}$/;

suite("tenant-qualified goal migration and repository", () => {
  let admin: Sql;
  const schemas: string[] = [];
  const clients: Sql[] = [];
  let migration: string;
  beforeAll(async () => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Goal ownership tests require the dedicated loopback postgres/app fixture.");
    }
    migration = await readFile(new URL("../drizzle/0018_goal_ownership.sql", import.meta.url), "utf8");
    admin = postgres(url!, { max: 2, onnotice: () => {} });
  });
  afterAll(async () => {
    try {
      for (const client of clients) await client.end({ timeout: 5 });
      if (admin) for (const name of schemas) {
        if (!ownedSchema.test(name)) throw new Error("Refusing to remove an unowned goal fixture schema.");
        await admin.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      }
    } finally { if (admin) await admin.end({ timeout: 5 }); }
  });

  async function fixture() {
    const name = `pointup_goal_fixture_${randomUUID().replaceAll("-", "")}`;
    schemas.push(name);
    await admin.unsafe(`CREATE SCHEMA "${name}"`);
    const sql = postgres<Record<string, never>>(url!, { max: 4, connection: { search_path: name }, onnotice: () => {} });
    clients.push(sql);
    // PR14's relevant pre-0018 shape. No fabricated CSV ordering: position is
    // the existing normalized value. Other domain tables are not required.
    await sql.unsafe(`
      CREATE TABLE loyalty_account (id varchar(255) PRIMARY KEY, user_id varchar(255) NOT NULL);
      CREATE TABLE trip_goal (
        id varchar(255) PRIMARY KEY, user_id varchar(255) NOT NULL,
        title varchar(120) NOT NULL, target_points bigint NOT NULL,
        target_date varchar(10), status varchar(16) NOT NULL, notes varchar(2000),
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
      CREATE TABLE trip_goal_account (
        goal_id varchar(255) NOT NULL, account_id varchar(255) NOT NULL, position integer NOT NULL,
        PRIMARY KEY (goal_id, account_id),
        CONSTRAINT trip_goal_account_goal_id_trip_goal_id_fk FOREIGN KEY (goal_id) REFERENCES trip_goal(id) ON DELETE CASCADE,
        CONSTRAINT trip_goal_account_account_id_loyalty_account_id_fk FOREIGN KEY (account_id) REFERENCES loyalty_account(id) ON DELETE CASCADE);
      INSERT INTO loyalty_account VALUES ('a1','owner'), ('a2','owner'), ('foreign','other');
      INSERT INTO trip_goal VALUES ('g','owner','Original',1000,NULL,'active',NULL,now(),now());
    `);
    const migrate = (afterLock?: () => Promise<void>) => sql.begin(async tx => {
      for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) {
        await tx.unsafe(statement);
        if (statement.includes("LOCK TABLE") && afterLock) await afterLock();
      }
    });
    const db = drizzle(sql, { schema });
    return { sql, migrate, repo: new DrizzleTripGoalRepository(db), name };
  }

  it("quarantines exact foreign and missing-parent rows before owner backfill", async () => {
    const f = await fixture();
    await f.sql.unsafe(`
      INSERT INTO trip_goal_account VALUES ('g','a1',7), ('g','foreign',3);
      ALTER TABLE trip_goal_account DROP CONSTRAINT trip_goal_account_goal_id_trip_goal_id_fk;
      ALTER TABLE trip_goal_account DROP CONSTRAINT trip_goal_account_account_id_loyalty_account_id_fk;
      INSERT INTO trip_goal_account VALUES ('missing-goal','a2',11), ('g','missing-account',13);
      ALTER TABLE trip_goal_account ADD CONSTRAINT trip_goal_account_goal_id_trip_goal_id_fk FOREIGN KEY (goal_id) REFERENCES trip_goal(id) NOT VALID;
      ALTER TABLE trip_goal_account ADD CONSTRAINT trip_goal_account_account_id_loyalty_account_id_fk FOREIGN KEY (account_id) REFERENCES loyalty_account(id) NOT VALID;
    `);
    await f.migrate();
    expect(await f.sql`SELECT goal_id, account_id, user_id, position FROM trip_goal_account`).toEqual([
      { goal_id: "g", account_id: "a1", user_id: "owner", position: 7 },
    ]);
    const review = await f.sql`SELECT reason, original_row, provenance FROM trip_goal_membership_review ORDER BY reason`;
    expect(review).toEqual([
      { reason: "different_owner", original_row: { goal_id: "g", account_id: "foreign", position: 3 }, provenance: "0018_goal_ownership:trip_goal_account" },
      { reason: "missing_account", original_row: { goal_id: "g", account_id: "missing-account", position: 13 }, provenance: "0018_goal_ownership:trip_goal_account" },
      { reason: "missing_goal", original_row: { goal_id: "missing-goal", account_id: "a2", position: 11 }, provenance: "0018_goal_ownership:trip_goal_account" },
    ]);
    await f.sql`DELETE FROM trip_goal WHERE id = 'g'`;
    expect(await f.sql`SELECT * FROM trip_goal_account`).toHaveLength(0);
    expect(await f.sql`SELECT * FROM trip_goal_membership_review`).toHaveLength(3);
  });

  it("blocks old writers before quarantine so concurrent foreign inserts cannot disappear unarchived", async () => {
    const f = await fixture();
    await f.sql`INSERT INTO trip_goal_account VALUES ('g','foreign',3)`;
    let releaseLock!: () => void;
    let markLocked!: () => void;
    const hold = new Promise<void>(resolve => { releaseLock = resolve; });
    const locked = new Promise<void>(resolve => { markLocked = resolve; });
    const migrating = f.migrate(async () => { markLocked(); await hold; });
    await locked;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    let writerPid = 0;
    const writing = f.sql.begin(async tx => {
      const [row] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (!row) throw new Error("Missing fixture writer PID.");
      writerPid = row.pid;
      markStarted();
      await tx`INSERT INTO trip_goal_account (goal_id, account_id, position) VALUES ('g','foreign',8)`;
    });
    // Observe rejection immediately to avoid an unhandled promise on release.
    const outcome = writing.then(() => null, (error: unknown) => error);
    try {
      await started;
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [row] = await admin<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid = ${writerPid} AND wait_event_type = 'Lock') AS blocked`;
        if (row?.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    } finally { releaseLock(); }
    await migrating;
    expect(await outcome).toMatchObject({ code: "23503" });
    expect(await f.sql`SELECT reason, original_row FROM trip_goal_membership_review`).toEqual([
      { reason: "different_owner", original_row: { goal_id: "g", account_id: "foreign", position: 3 } },
    ]);
    expect(await f.sql`SELECT * FROM trip_goal_account`).toHaveLength(0);
  });

  it("rejects direct foreign links and parent owner reassignment; keeps cascades", async () => {
    const f = await fixture();
    await f.migrate();
    await expect(f.sql`INSERT INTO trip_goal_account VALUES ('g','foreign',0,'owner')`).rejects.toMatchObject({ code: "23503" });
    await expect(f.sql`INSERT INTO trip_goal_account (goal_id,account_id,position,user_id) VALUES ('g','a1',0,'other')`).rejects.toMatchObject({ code: "23503" });
    await f.sql`INSERT INTO trip_goal_account (goal_id,account_id,position,user_id) VALUES ('g','a1',0,'owner')`;
    await expect(f.sql`UPDATE loyalty_account SET user_id='other' WHERE id='a1'`).rejects.toMatchObject({ code: "23503" });
    await expect(f.sql`UPDATE trip_goal SET user_id='other' WHERE id='g'`).rejects.toMatchObject({ code: "23503" });
    await f.sql`DELETE FROM loyalty_account WHERE id='a1'`;
    expect(await f.sql`SELECT * FROM trip_goal_account`).toHaveLength(0);
    const flags = await f.sql`SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = ${f.name}::regnamespace AND relname IN ('trip_goal_account','trip_goal_membership_review') ORDER BY relname`;
    expect(flags).toEqual([{ relname: "trip_goal_account", relrowsecurity: true }, { relname: "trip_goal_membership_review", relrowsecurity: true }]);
  });

  it("accepts old-shape writers without weakening explicit or account ownership", async () => {
    const f = await fixture();
    await f.migrate();
    await f.sql`INSERT INTO trip_goal_account (goal_id, account_id, position) VALUES ('g','a1',4)`;
    expect(await f.sql`SELECT user_id, position FROM trip_goal_account`).toEqual([{ user_id: "owner", position: 4 }]);
    await expect(f.sql`INSERT INTO trip_goal_account (goal_id, account_id, position) VALUES ('g','foreign',0)`).rejects.toMatchObject({ code: "23503" });
    await expect(f.sql`INSERT INTO trip_goal_account (goal_id, account_id, position) VALUES ('missing','a2',0)`).rejects.toMatchObject({ code: "23502" });
    await f.sql`UPDATE trip_goal_account SET user_id = NULL, position = 5 WHERE goal_id = 'g' AND account_id = 'a1'`;
    expect(await f.sql`SELECT user_id, position FROM trip_goal_account`).toEqual([{ user_id: "owner", position: 5 }]);
    await expect(f.sql`UPDATE trip_goal_account SET user_id = 'other', position = 99 WHERE goal_id = 'g' AND account_id = 'a1'`).rejects.toMatchObject({ code: "23503" });
    expect(await f.sql`SELECT user_id, position FROM trip_goal_account`).toEqual([{ user_id: "owner", position: 5 }]);
    await expect(f.sql.begin(async tx => {
      await tx`UPDATE trip_goal_account SET position = 100 WHERE goal_id = 'g' AND account_id = 'a1'`;
      await tx`INSERT INTO trip_goal_account (goal_id, account_id, position) VALUES ('g','foreign',0)`;
    })).rejects.toMatchObject({ code: "23503" });
    expect(await f.sql`SELECT user_id, position FROM trip_goal_account`).toEqual([{ user_id: "owner", position: 5 }]);
  });

  it("rolls back replacement on an unavailable account and rejects a forged goal owner", async () => {
    const f = await fixture();
    await f.migrate();
    const goal = createTripGoal({ id: TripGoalId.parse("g"), userId: UserId.parse("owner"), title: "Original", targetPoints: 1000, accountIds: [LoyaltyAccountId.parse("a1")] });
    await f.repo.update(goal);
    await expect(f.repo.update({ ...goal, title: "Must rollback", accountIds: [LoyaltyAccountId.parse("foreign")] })).rejects.toBeDefined();
    expect(await f.repo.findById(goal.id)).toMatchObject({ title: "Original", accountIds: ["a1"] });
    await expect(f.repo.update({ ...goal, userId: UserId.parse("other"), accountIds: [] })).rejects.toMatchObject({ code: "TRIP_GOAL_NOT_FOUND" });
    expect(await f.repo.findById(goal.id)).toMatchObject({ accountIds: ["a1"] });
  });

  it("serializes concurrent replacements without combining their membership sets", async () => {
    const f = await fixture();
    await f.migrate();
    const goal = createTripGoal({ id: TripGoalId.parse("g"), userId: UserId.parse("owner"), title: "Original", targetPoints: 1000 });
    await Promise.all([
      f.repo.update({ ...goal, title: "First", accountIds: [LoyaltyAccountId.parse("a1"), LoyaltyAccountId.parse("a2")] }),
      f.repo.update({ ...goal, title: "Second", accountIds: [LoyaltyAccountId.parse("a2")] }),
    ]);
    const stored = await f.repo.findById(goal.id);
    if (!stored) throw new Error("Missing fixture goal.");
    expect(stored.accountIds).toEqual(stored.title === "First" ? ["a1", "a2"] : ["a2"]);
    expect((await f.sql`SELECT DISTINCT user_id FROM trip_goal_account`)).toEqual([{ user_id: "owner" }]);
  });
});
