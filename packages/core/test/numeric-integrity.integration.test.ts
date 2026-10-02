import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { sql as query } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../src/infrastructure/db/schema";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";
import { DrizzleBalanceSnapshotRepository, DrizzleTripGoalRepository, DrizzleLoyaltyAccountRepository, DrizzleActivityEventRepository } from "../src/infrastructure/repositories/drizzle-loyalty-account-repository";
import { DrizzleCustomValuationRepository } from "../src/infrastructure/repositories/drizzle-custom-valuation-repository";
import { DrizzleAwardWatchRepository } from "../src/infrastructure/repositories/drizzle-award-watch-repository";
import { DrizzleUnitOfWork, DrizzleEventPublisher } from "../src/infrastructure/outbox/drizzle-outbox";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { AwardWatchId, LoyaltyAccountId, TripGoalId, UserId } from "../src/domain/shared/ids";
import { createAwardWatch, recordCheck } from "../src/domain/loyalty/award-watch";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const owned = /^pointup_numeric_fixture_[a-f0-9]{32}$/;
const checks = ["balance_snapshot_points_check", "balance_snapshot_source_check", "trip_goal_target_points_check", "trip_goal_status_check", "user_provider_valuation_milli_check", "award_watch_threshold_milli_check", "award_watch_best_milli_check"];
suite("numeric integrity adoption and guarded adapters on isolated PostgreSQL", () => {
  let admin: Sql;
  let migration: string;
  const schemas: string[] = [];
  const clients: Sql[] = [];
  beforeAll(async () => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") throw new Error("Numeric tests require dedicated loopback postgres/app.");
    migration = await readFile(new URL("../drizzle/0020_numeric_integrity.sql", import.meta.url), "utf8");
    admin = postgres(url!, { max: 2, onnotice: () => {} });
  });
  afterAll(async () => {
    if (!admin) return;
    try {
      for (const client of clients) await client.end({ timeout: 5 });
      for (const name of schemas) {
        if (!owned.test(name)) throw new Error("Refusing to remove an unowned numeric schema.");
        await admin.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      }
    } finally { await admin.end({ timeout: 5 }); }
  });
  async function fixture() {
    const name = `pointup_numeric_fixture_${randomUUID().replaceAll("-", "")}`;
    schemas.push(name);
    await admin.unsafe(`CREATE SCHEMA "${name}"`);
    const client = postgres<Record<string, never>>(url!, { max: 4, connection: { search_path: name }, onnotice: () => {} });
    clients.push(client);
    await client.unsafe(`
      CREATE TABLE loyalty_account (id varchar(255) PRIMARY KEY,user_id varchar(255) NOT NULL,provider_id varchar(64) NOT NULL,
        membership_number varchar(255) NOT NULL,credential_ref varchar(512),expires_at timestamptz,notes varchar(2000),pinned_at timestamptz,
        deleted_at timestamptz,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
      CREATE TABLE account_tag (account_id varchar(255) NOT NULL,tag varchar(64) NOT NULL,position integer NOT NULL,PRIMARY KEY(account_id,tag));
      CREATE TABLE balance_snapshot (id varchar(255) PRIMARY KEY,loyalty_account_id varchar(255) NOT NULL,points bigint NOT NULL,source varchar(16) NOT NULL,captured_at timestamptz NOT NULL);
      CREATE TABLE trip_goal (id varchar(255) PRIMARY KEY,user_id varchar(255) NOT NULL,title varchar(120) NOT NULL,target_points bigint NOT NULL,target_date varchar(10),status varchar(16) NOT NULL,notes varchar(2000),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
      CREATE TABLE trip_goal_account (goal_id varchar(255) NOT NULL,user_id varchar(255) NOT NULL,account_id varchar(255) NOT NULL,position integer NOT NULL);
      CREATE TABLE user_provider_valuation (user_id varchar(255) NOT NULL,provider_id varchar(64) NOT NULL,cents_per_point_milli integer NOT NULL,updated_at timestamptz NOT NULL,PRIMARY KEY(user_id,provider_id));
      CREATE TABLE award_watch (id varchar(255) PRIMARY KEY,user_id varchar(255) NOT NULL,url varchar(2048) NOT NULL,label varchar(120) NOT NULL,min_cents_per_point_milli integer NOT NULL,best_seen_cents_per_point_milli integer,last_checked_at timestamptz,last_notified_at timestamptz,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
      CREATE TABLE agent_observation (id text PRIMARY KEY,points bigint NOT NULL,previous_points bigint,outcome text NOT NULL);
      CREATE TABLE activity_event (id varchar(255) PRIMARY KEY,user_id varchar(255) NOT NULL,type varchar(32) NOT NULL,account_id varchar(255),provider_id varchar(64),summary varchar(512) NOT NULL,occurred_at timestamptz NOT NULL);
      CREATE TABLE domain_event_outbox (id varchar(255) PRIMARY KEY,type varchar(64) NOT NULL,version integer NOT NULL,user_id varchar(255) NOT NULL,aggregate_id varchar(255) NOT NULL,payload jsonb NOT NULL,occurred_at timestamptz NOT NULL,correlation_id varchar(255),attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL,processed_at timestamptz,dead_lettered_at timestamptz,last_error varchar(1000));
      INSERT INTO loyalty_account VALUES('a','owner','united','synthetic',NULL,'2030-01-01T00:00:00Z','original',NULL,NULL,now(),now());
    `);
    const apply = (timeoutMs?: number) => client.begin(async tx => {
      for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) {
        if (timeoutMs && statement.includes("SET LOCAL lock_timeout")) await tx.unsafe(`SET LOCAL lock_timeout='${timeoutMs}ms'`);
        else await tx.unsafe(statement);
      }
    });
    const db = drizzle(client, { schema });
    return { name, client, db, apply, balances: new DrizzleBalanceSnapshotRepository(db), goals: new DrizzleTripGoalRepository(db),
      valuations: new DrizzleCustomValuationRepository(db), watches: new DrizzleAwardWatchRepository(db) };
  }
  async function seedInvalid(f: Awaited<ReturnType<typeof fixture>>) {
    await f.client.unsafe(`
      INSERT INTO balance_snapshot VALUES('unsafe','a',9223372036854775807,'unexpected','2026-10-01T00:00:00Z'),('negative','a',-1,'manual','2026-09-01T00:00:00Z');
      INSERT INTO trip_goal VALUES('bad-goal','owner','Retained',9007199254740992,NULL,'unexpected',NULL,now(),now());
      INSERT INTO user_provider_valuation VALUES('owner','united',0,now());
      INSERT INTO award_watch VALUES('bad-watch','owner','https://example.test','Retained',0,-1,NULL,NULL,now(),now());
      INSERT INTO agent_observation VALUES('legacy-review',9223372036854775807,-1,'needs_review');
    `);
  }
  async function originals(f: Awaited<ReturnType<typeof fixture>>) {
    const rows: unknown[] = [];
    for (const table of ["balance_snapshot", "trip_goal", "user_provider_valuation", "award_watch", "agent_observation"]) rows.push(await f.client.unsafe(`SELECT to_jsonb(t)::text AS original FROM "${table}" t ORDER BY to_jsonb(t)::text`));
    return rows;
  }

  it("preserves exact invalid originals with all seven checks NOT VALID and leaves legacy cleanup possible", async () => {
    const f = await fixture(); await seedInvalid(f);
    const before = await originals(f);
    await f.apply();
    expect(await originals(f)).toEqual(before);
    const constraints = await admin`SELECT conname,convalidated FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=${f.name} AND contype='c' ORDER BY conname`;
    expect(constraints.map(row => row.conname)).toEqual([...checks].sort());
    expect(constraints.every(row => row.convalidated === false)).toBe(true);
    await f.client`UPDATE agent_observation SET outcome='rejected' WHERE id='legacy-review'`;
    expect((await f.client`SELECT points::text AS points FROM agent_observation`)[0]?.points).toBe("9223372036854775807");
    await expect(f.client`UPDATE trip_goal SET notes='unrelated' WHERE id='bad-goal'`).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces new direct writes, keeps agent sources, and preserves safe maxima", async () => {
    const f = await fixture(); await f.apply();
    await f.client`INSERT INTO balance_snapshot VALUES('safe','a',${String(Number.MAX_SAFE_INTEGER)},'agent',now())`;
    for (const value of ["-1", "9007199254740992"]) await expect(f.client`INSERT INTO balance_snapshot VALUES(${randomUUID()},'a',${value},'manual',now())`).rejects.toMatchObject({ code: "23514" });
    await expect(f.client`UPDATE balance_snapshot SET source='unexpected' WHERE id='safe'`).rejects.toMatchObject({ code: "23514" });
    await f.client`INSERT INTO trip_goal VALUES('safe-goal','owner','Safe',${String(Number.MAX_SAFE_INTEGER)},NULL,'active',NULL,now(),now())`;
    await expect(f.client`UPDATE trip_goal SET target_points=0 WHERE id='safe-goal'`).rejects.toMatchObject({ code: "23514" });
    await expect(f.client`UPDATE trip_goal SET status='unexpected' WHERE id='safe-goal'`).rejects.toMatchObject({ code: "23514" });
    await expect(f.client`INSERT INTO user_provider_valuation VALUES('owner','united',0,now())`).rejects.toMatchObject({ code: "23514" });
    await f.client`INSERT INTO award_watch VALUES('safe-watch','owner','https://example.test','Safe',1,2147483647,NULL,NULL,now(),now())`;
    await expect(f.client`UPDATE award_watch SET min_cents_per_point_milli=100001 WHERE id='safe-watch'`).rejects.toMatchObject({ code: "23514" });
    await expect(f.client`UPDATE award_watch SET best_seen_cents_per_point_milli=-1 WHERE id='safe-watch'`).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses dirty validation and succeeds only after explicit fixture repairs", async () => {
    const f = await fixture(); await seedInvalid(f); await f.apply();
    for (const [table, constraint] of [["balance_snapshot",checks[0]],["balance_snapshot",checks[1]],["trip_goal",checks[2]],["trip_goal",checks[3]],["user_provider_valuation",checks[4]],["award_watch",checks[5]],["award_watch",checks[6]]]) {
      await expect(f.client.unsafe(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}"`)).rejects.toMatchObject({ code: "23514" });
    }
    // Synthetic repairs are explicit and confined to this owned fixture; no
    // production history is guessed, clamped or automatically rewritten.
    await f.client.unsafe(`UPDATE balance_snapshot SET points=1,source='manual'; UPDATE trip_goal SET target_points=1,status='active'; UPDATE user_provider_valuation SET cents_per_point_milli=1; UPDATE award_watch SET min_cents_per_point_milli=1,best_seen_cents_per_point_milli=0;`);
    for (const [table, constraint] of [["balance_snapshot",checks[0]],["balance_snapshot",checks[1]],["trip_goal",checks[2]],["trip_goal",checks[3]],["user_provider_valuation",checks[4]],["award_watch",checks[5]],["award_watch",checks[6]]]) await f.client.unsafe(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}"`);
    expect((await admin`SELECT convalidated FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=${f.name} AND contype='c'`).every(row => row.convalidated === true)).toBe(true);
  });

  it("fails legacy bigint and milli reads explicitly instead of rounding or inventing zero", async () => {
    const f = await fixture(); await seedInvalid(f); await f.apply();
    const account = LoyaltyAccountId.parse("a");
    await expect(f.balances.findLatestByAccountIds([account])).rejects.toMatchObject({ code: "INVALID_BALANCE" });
    await expect(f.balances.findTrendContextByAccountIds([account], new Date())).rejects.toMatchObject({ code: "INVALID_BALANCE" });
    await expect(f.balances.findByAccountId(account, 10)).rejects.toMatchObject({ code: "INVALID_BALANCE" });
    await expect(f.goals.findById(TripGoalId.parse("bad-goal"))).rejects.toThrow();
    await expect(f.valuations.listForUser(UserId.parse("owner"))).rejects.toMatchObject({ code: "INVALID_VALUATION" });
    await expect(f.watches.findById(AwardWatchId.parse("bad-watch"))).rejects.toMatchObject({ code: "INVALID_AWARD_WATCH" });
    expect((await f.client`SELECT points::text AS points FROM balance_snapshot WHERE id='unsafe'`)[0]?.points).toBe("9223372036854775807");
  });

  it("matches normalized milli readback and aligns history ties with latest", async () => {
    const f = await fixture(); await f.apply();
    const owner = UserId.parse("owner");
    await f.valuations.upsert({ userId: owner, providerId: "united", centsPerPoint: 1.2345, updatedAt: new Date() });
    expect((await f.valuations.listForUser(owner))[0]?.centsPerPoint).toBe(1.235);
    const watch = recordCheck(createAwardWatch({ userId: owner, url: "https://example.test", label: "Synthetic", minCentsPerPoint: 1.2345 }), { bestRealizedCpp: 200.1234, notified: true, now: new Date() });
    await f.watches.insert(watch);
    expect(await f.watches.findById(watch.id)).toMatchObject({ minCentsPerPoint: 1.235, bestSeenCentsPerPoint: 200.123 });
    await expect(f.valuations.upsert({ userId: owner, providerId: "united", centsPerPoint: 0.0001, updatedAt: new Date() })).rejects.toMatchObject({ code: "INVALID_VALUATION" });
    await f.client`INSERT INTO balance_snapshot VALUES('a-first','a',0,'manual','2026-10-02T00:00:00Z'),('z-last','a',${String(Number.MAX_SAFE_INTEGER)},'agent','2026-10-02T00:00:00Z')`;
    const account = LoyaltyAccountId.parse("a");
    expect((await f.balances.findByAccountId(account, 10)).map(row => row.id)).toEqual(["z-last","a-first"]);
    expect((await f.balances.findLatestByAccountIds([account])).get(account)?.points).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("preserves a concurrent pre-adoption writer while blocking DDL until commit", async () => {
    const f = await fixture();
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>(resolve => { acquired = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const writer = f.client.begin(async tx => {
      await tx`INSERT INTO balance_snapshot VALUES('concurrent-legacy','a',9007199254740992,'manual',now())`;
      acquired(); await unlock;
    });
    await held;
    const applying = f.apply();
    try {
      await vi.waitFor(async () => {
        const [row] = await admin<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE NOT granted AND mode='AccessExclusiveLock' AND relation=to_regclass(${f.name + '.balance_snapshot'})) AS blocked`;
        expect(row?.blocked).toBe(true);
      }, { timeout: 3000, interval: 10 });
    } finally { release(); await writer; }
    await applying;
    expect((await f.client`SELECT points::text AS points FROM balance_snapshot WHERE id='concurrent-legacy'`)[0]?.points).toBe('9007199254740992');
    await expect(f.client`INSERT INTO balance_snapshot VALUES('new-invalid','a',9007199254740992,'manual',now())`).rejects.toMatchObject({ code:'23514' });
  });

  it("a bounded DDL lock timeout rolls back adoption and leaves original history intact", async () => {
    const f = await fixture();
    await f.client`INSERT INTO balance_snapshot VALUES('original','a',123,'manual',now())`;
    const before = await originals(f);
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>(resolve => { acquired = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const writer = f.client.begin(async tx => { await tx`SELECT id FROM balance_snapshot FOR UPDATE`; acquired(); await unlock; });
    await held;
    try { await expect(f.apply(25)).rejects.toMatchObject({ code:'55P03' }); }
    finally { release(); await writer; }
    expect(await originals(f)).toEqual(before);
    expect(await admin`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=${f.name} AND contype='c'`).toHaveLength(0);
  });

  it("rolls back snapshot, account metadata, activity and outbox on a numeric check failure", async () => {
    const f = await fixture(); await f.apply();
    // The current repository also expects additive card migration 0021.
    const cards = await readFile(new URL("../drizzle/0021_card_product.sql", import.meta.url), "utf8");
    await f.client.begin(async tx => { await tx.unsafe(cards); });
    const uow = new DrizzleUnitOfWork(f.db);
    const publisher = new DrizzleEventPublisher(uow.db);
    const publish = publisher.publish.bind(publisher);
    const fault = vi.spyOn(publisher,"publish").mockImplementation(async events => {
      await publish(events);
      await uow.db.execute(query`INSERT INTO trip_goal VALUES('fault','owner','Fault',0,NULL,'active',NULL,now(),now())`);
    });
    const accounts = new DrizzleLoyaltyAccountRepository(uow.db);
    const balances = new DrizzleBalanceSnapshotRepository(uow.db);
    const activity = new DrizzleActivityEventRepository(uow.db);
    const record = new RecordManualBalance(accounts,balances,activity,undefined,{ unitOfWork:uow,publisher });
    const before = await f.client`SELECT to_jsonb(a)::text AS original FROM loyalty_account a`;
    try { await expect(record.execute({ userId:UserId.parse('owner'),accountId:LoyaltyAccountId.parse('a'),points:10 })).rejects.toMatchObject({ cause:{ code:'23514' } }); }
    finally { fault.mockRestore(); }
    expect(await f.client`SELECT to_jsonb(a)::text AS original FROM loyalty_account a`).toEqual(before);
    for(const table of ['balance_snapshot','activity_event','domain_event_outbox','trip_goal']) expect(await f.client.unsafe(`SELECT * FROM "${table}"`)).toHaveLength(0);
  });
});
