import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrateWithLock, MIGRATION_LOCK_KEY } from "../src/infrastructure/db/migrations";
import * as schema from "../src/infrastructure/db/schema";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createTripGoal } from "../src/domain/loyalty/trip-goal";
import { DrizzleLoyaltyAccountRepository, DrizzleBalanceSnapshotRepository, DrizzleTripGoalRepository } from "../src/infrastructure/repositories/drizzle-loyalty-account-repository";
import { DrizzlePortfolioUnitOfWork } from "../src/infrastructure/repositories/drizzle-portfolio-unit-of-work";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { ImportPortfolio } from "../src/application/loyalty/import-portfolio";

const url = process.env.PORTFOLIO_INTEGRATION_URL;
const suite = url ? describe : describe.skip;

suite("portfolio migration, tenant membership and mutation atomicity", () => {
  const owner = `portfolio-fixture-${randomUUID()}`;
  const otherOwner = owner + "-other";
  const legacyGoal = randomUUID();
  const legacyAccount = randomUUID();
  const foreignAccount = randomUUID();
  const missingAccount = randomUUID();
  let sql: ReturnType<typeof postgres>;
  let accounts: DrizzleLoyaltyAccountRepository;
  let balances: DrizzleBalanceSnapshotRepository;
  let goals: DrizzleTripGoalRepository;
  let uow: DrizzlePortfolioUnitOfWork;
  const clock = { now: () => new Date("2026-10-01T00:00:00Z") };

  beforeAll(async () => {
    const fixture = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(fixture.hostname) || fixture.pathname !== "/pointup_integration" || fixture.username !== "pointup_fixture") throw new Error("Portfolio suite requires the dedicated loopback fixture.");
    sql = postgres(url!, { max: 6, onnotice: () => {} });
    const db = drizzle(sql, { schema });
    const migrationFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
    const temporary = await mkdtemp(join(tmpdir(), "pointup-pre-integrity-"));
    try {
      await cp(migrationFolder, temporary, { recursive: true });
      const journal = JSON.parse(await readFile(join(temporary, "meta/_journal.json"), "utf8"));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 9);
      await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(journal));
      const concurrentMigrate = async (folder: string) => {
        const client = postgres(url!, {max:2,onnotice:() => {}});
        try { await migrateWithLock(drizzle(client),{migrationsFolder:folder}); }
        finally { await client.end({timeout:5}); }
      };
      await Promise.all([concurrentMigrate(temporary),concurrentMigrate(temporary)]);
      await sql`INSERT INTO loyalty_account (id,user_id,provider_id,membership_number,tags,created_at,updated_at)
        VALUES (${legacyAccount},${owner},'hyatt','legacy','work, personal',now(),now()),
        (${foreignAccount},${otherOwner},'united','foreign','',now(),now())`;
      await sql`INSERT INTO trip_goal (id,user_id,title,target_points,account_ids,status,created_at,updated_at)
        VALUES (${legacyGoal},${owner},'Legacy',1000,${[legacyAccount, foreignAccount, missingAccount, legacyAccount].join(",")},'active',now(),now())`;
      await sql`INSERT INTO trip_goal (id,user_id,title,target_points,account_ids,status,created_at,updated_at)
        VALUES (${randomUUID()},${otherOwner},'Historic unsafe target',9007199254740992,'','active',now(),now())`;
      // Stage checks without rewriting unsafe historic balances.
      await sql`INSERT INTO balance_snapshot VALUES (${randomUUID()},${legacyAccount},9007199254740992,'manual',now())`;
      await Promise.all([concurrentMigrate(migrationFolder),concurrentMigrate(migrationFolder)]);
    } finally { await rm(temporary, { recursive: true, force: true }); }
    accounts = new DrizzleLoyaltyAccountRepository(db);
    balances = new DrizzleBalanceSnapshotRepository(db);
    goals = new DrizzleTripGoalRepository(db);
    uow = new DrizzlePortfolioUnitOfWork(db);
  }, 30_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM trip_goal WHERE user_id IN (${owner},${otherOwner})`;
    await sql`DELETE FROM trip_goal_membership_review WHERE user_id = ${owner}`;
    await sql`DELETE FROM activity_event WHERE user_id = ${owner}`;
    await sql`DELETE FROM loyalty_account WHERE user_id IN (${owner},${otherOwner})`;
    await sql.end({ timeout: 5 });
  });

  it("serializes independent concurrent migration clients before journal reads", async () => {
    const rows = await sql`SELECT count(*)::int AS total,count(DISTINCT created_at)::int AS unique_entries FROM drizzle.__drizzle_migrations`;
    const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json",import.meta.url),"utf8"));
    expect(rows[0]?.total).toBe(journal.entries.length);
    expect(rows[0]?.unique_entries).toBe(journal.entries.length);
  });

  it("bounds lock contention and leaves no migration session lock after failure", async () => {
    const blocker = postgres(url!,{max:1,onnotice:() => {}});
    const contender = postgres(url!,{max:2,onnotice:() => {}});
    try {
      await blocker`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
      await expect(migrateWithLock(drizzle(contender),{migrationsFolder:fileURLToPath(new URL("../drizzle",import.meta.url))},{lockTimeoutMs:25}))
        .rejects.toMatchObject({code:"55P03"});
      await blocker`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      await migrateWithLock(drizzle(contender),{migrationsFolder:fileURLToPath(new URL("../drizzle",import.meta.url))});
      expect((await blocker`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS acquired`)[0]?.acquired).toBe(true);
      await blocker`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    } finally {
      await blocker.end({timeout:5});
      await contender.end({timeout:5});
    }
  });

  it("releases a held migration lock after actual SQL rollback", async () => {
    const temporary = await mkdtemp(join(tmpdir(),"pointup-failed-migration-"));
    const probe = postgres(url!,{max:1,onnotice:() => {}});
    const migrationClient = postgres(url!,{max:2,onnotice:() => {}});
    try {
      await cp(fileURLToPath(new URL("../drizzle/meta",import.meta.url)),join(temporary,"meta"),{recursive:true});
      await writeFile(join(temporary,"meta/_journal.json"),JSON.stringify({version:"7",dialect:"postgresql",entries:[{idx:0,version:"7",when:1999999999999,tag:"0000_fixture_failure",breakpoints:true}]}));
      await writeFile(join(temporary,"0000_fixture_failure.sql"),"SELECT fixture_nonexistent_column FROM loyalty_account;");
      await expect(migrateWithLock(drizzle(migrationClient),{migrationsFolder:temporary})).rejects.toThrow();
      expect((await probe`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS acquired`)[0]?.acquired).toBe(true);
      await probe`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      expect(await sql`SELECT id FROM drizzle.__drizzle_migrations WHERE created_at = 1999999999999`).toHaveLength(0);
    } finally {
      await migrationClient.end({timeout:5});
      await probe.end({timeout:5});
      await rm(temporary,{recursive:true,force:true});
    }
  });

  it("backfills valid deduplicated links and quarantines invalid history while repairing the legacy CSV projection", async () => {
    expect((await goals.findById(legacyGoal))?.accountIds).toEqual([legacyAccount]);
    const rows = await sql`SELECT account_id,reason FROM trip_goal_membership_review WHERE goal_id = ${legacyGoal} ORDER BY reason`;
    expect(rows.map(row => [row.account_id,row.reason])).toEqual([[foreignAccount,"different_owner"],[missingAccount,"missing_account"]]);
    expect((await sql`SELECT account_ids FROM trip_goal WHERE id = ${legacyGoal}`)[0]?.account_ids).toBe(legacyAccount);
    const reviewed = await sql`SELECT legacy_account_ids FROM trip_goal_membership_review WHERE goal_id = ${legacyGoal}`;
    expect(reviewed.every(row => row.legacy_account_ids === [legacyAccount,foreignAccount,missingAccount,legacyAccount].join(","))).toBe(true);
    expect((await accounts.findById(legacyAccount))?.tags).toEqual(["work","personal"]);
    const checks = await sql`SELECT convalidated FROM pg_constraint WHERE conname IN ('balance_snapshot_points_check','balance_snapshot_source_check','trip_goal_target_points_check','trip_goal_status_check')`;
    expect(checks).toHaveLength(4);
    expect(checks.every(row => !row.convalidated)).toBe(true);
    expect(await sql`SELECT id FROM trip_goal WHERE user_id = ${otherOwner} AND target_points > 9007199254740991`).toHaveLength(1);
  });

  it("hides quarantined tenant references even after a browser role receives a SELECT grant", async () => {
    const role = `pointup_review_${randomUUID().replaceAll("-", "")}`;
    await sql.unsafe(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    try {
      await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await sql.unsafe(`GRANT SELECT ON trip_goal_membership_review TO ${role}`);
      const visible = await sql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        return tx`SELECT * FROM trip_goal_membership_review`;
      });
      expect(visible).toHaveLength(0);
      expect(await sql`SELECT account_id FROM trip_goal_membership_review WHERE goal_id = ${legacyGoal}`).toHaveLength(2);
    } finally {
      await sql.unsafe(`DROP OWNED BY ${role}`);
      await sql.unsafe(`DROP ROLE ${role}`);
    }
  });

  it("rejects wrong-tenant membership for both parent CSV writes and direct relation writes", async () => {
    await expect(goals.insert(createTripGoal({userId:owner,title:"Invalid",targetPoints:100,accountIds:[foreignAccount]}))).rejects.toThrow();
    await expect(sql`INSERT INTO trip_goal_account VALUES (${legacyGoal},${owner},${foreignAccount},1)`).rejects.toMatchObject({code:"23503"});
    await expect(sql`INSERT INTO trip_goal_account VALUES (${legacyGoal},${otherOwner},${foreignAccount},1)`).rejects.toMatchObject({code:"23503"});
    expect(await goals.findByUserId(owner)).toHaveLength(1);
  });

  it("keeps parent and membership replacement atomic on failure", async () => {
    const goal = createTripGoal({userId:owner,title:"Before",targetPoints:100,accountIds:[legacyAccount]});
    await goals.insert(goal);
    await expect(goals.update({...goal,title:"Must roll back",accountIds:[foreignAccount]})).rejects.toThrow();
    expect((await goals.findById(goal.id))?.title).toBe("Before");
    expect((await goals.findById(goal.id))?.accountIds).toEqual([legacyAccount]);
    await goals.delete(goal.id);
  });

  it("serializes concurrent replacement and preserves ordered deduplicated memberships", async () => {
    const second = createLoyaltyAccount({userId:owner,providerId:"delta",membershipNumber:"second"});
    await accounts.insert(second);
    const goal = createTripGoal({userId:owner,title:"Initial",targetPoints:100,accountIds:[legacyAccount]});
    await goals.insert(goal);
    await Promise.all([goals.update({...goal,title:"First",accountIds:[second.id,legacyAccount,second.id]}),goals.update({...goal,title:"Second",accountIds:[legacyAccount]})]);
    const stored = await goals.findById(goal.id);
    expect(stored?.accountIds).toEqual(stored?.title === "First" ? [second.id,legacyAccount] : [legacyAccount]);
    await goals.delete(goal.id);
  });

  it("round trips all twenty maximum-length tags and synchronizes legacy writers", async () => {
    const tags = Array.from({length:20},(_,i) => `${i}`.padEnd(32,"x"));
    const account = createLoyaltyAccount({userId:owner,providerId:"american",membershipNumber:"tags",tags});
    await accounts.insert(account);
    expect((await accounts.findById(account.id))?.tags).toEqual(tags);
    await sql`UPDATE loyalty_account SET tags = 'old, host' WHERE id = ${account.id}`;
    expect((await accounts.findById(account.id))?.tags).toEqual(["old","host"]);
    await accounts.update({...account,tags});
    expect((await accounts.findById(account.id))?.tags).toEqual(tags);
    // Explicit array changes remain lossless even where legacy CSV is ambiguous.
    await sql`UPDATE loyalty_account SET tags = 'comma,tag', tag_values = ARRAY['comma,tag'] WHERE id = ${account.id}`;
    expect((await accounts.findById(account.id))?.tags).toEqual(["comma,tag"]);
  });

  it("enforces storage ranges and enums on new writes while retaining historic violations", async () => {
    for (const points of [-1,9007199254740992]) await expect(sql`INSERT INTO balance_snapshot VALUES (${randomUUID()},${legacyAccount},${points},'manual',now())`).rejects.toMatchObject({code:"23514"});
    await expect(sql`INSERT INTO balance_snapshot VALUES (${randomUUID()},${legacyAccount},1,'bogus',now())`).rejects.toMatchObject({code:"23514"});
    await expect(goals.insert({...createTripGoal({userId:owner,title:"Invalid target",targetPoints:100}),targetPoints:0})).rejects.toThrow();
    await expect(sql`UPDATE trip_goal SET status = 'bogus' WHERE id = ${legacyGoal}`).rejects.toMatchObject({code:"23514"});
    expect(await sql`SELECT id FROM balance_snapshot WHERE loyalty_account_id = ${legacyAccount} AND points > 9007199254740991`).toHaveLength(1);
  });

  it("owner-qualified repository updates cannot mutate another owner's account or goal", async () => {
    const account = (await accounts.findById(legacyAccount))!;
    await accounts.update({...account,userId:otherOwner,membershipNumber:"must-not-change"});
    expect((await accounts.findById(legacyAccount))?.membershipNumber).toBe("legacy");
    const goal = (await goals.findById(legacyGoal))!;
    await goals.update({...goal,userId:otherOwner,title:"must-not-change"});
    expect((await goals.findById(legacyGoal))?.title).toBe("Legacy");
  });

  it("rolls back a manual snapshot when its activity insert fails", async () => {
    const broken: import("../src/application/loyalty/portfolio-unit-of-work").PortfolioUnitOfWork = {run: (userId, operation) => uow.run(userId,scope => operation({...scope,activity:{insert: async () => {throw new Error("fixture feed failure");},findByUserId:scope.activity.findByUserId.bind(scope.activity)}}))};
    const before = await balances.findByAccountId(legacyAccount,100);
    const record = new RecordManualBalance(accounts,balances,undefined,clock,broken);
    await expect(record.execute({userId:owner,accountId:legacyAccount,points:5})).rejects.toThrow("fixture feed failure");
    expect(await balances.findByAccountId(legacyAccount,100)).toHaveLength(before.length);
  });

  it("rolls back an entire import after a later observation fails", async () => {
    const broken: import("../src/application/loyalty/portfolio-unit-of-work").PortfolioUnitOfWork = {
      run: (userId, operation) => uow.run(userId, scope => {
        let writes = 0;
        return operation({...scope,balances:{insert:async snapshot => {if (++writes === 2) throw new Error("fixture second balance failure");await scope.balances.insert(snapshot);},findLatestByAccountIds:scope.balances.findLatestByAccountIds.bind(scope.balances),findByAccountId:scope.balances.findByAccountId.bind(scope.balances),findTrendContextByAccountIds:scope.balances.findTrendContextByAccountIds.bind(scope.balances)}});
      }),
    };
    const importer = new ImportPortfolio(accounts,new LinkLoyaltyAccount(accounts),new RecordManualBalance(accounts,balances),clock,broken);
    await expect(importer.execute({userId:owner,csv:"providerId,membershipNumber,points,capturedAt\nmarriott,import,10,2026-09-01\nmarriott,import,20,2026-09-02"})).rejects.toThrow("fixture second balance failure");
    expect(await accounts.findByUserAndProvider(owner,"marriott")).toBeNull();
    expect(await sql`SELECT id FROM activity_event WHERE user_id = ${owner}`).toHaveLength(0);
  });

  it("serializes conflicting concurrent imports before membership preflight", async () => {
    const importer = new ImportPortfolio(accounts,new LinkLoyaltyAccount(accounts),new RecordManualBalance(accounts,balances),clock,uow);
    const results = await Promise.allSettled(["a","b"].map(member => importer.execute({userId:owner,csv:`providerId,membershipNumber,points,capturedAt\nhilton,${member},10,2026-09-01`})));
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(row => row.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.code).toBe("INVALID_IMPORT");
    const account = (await accounts.findByUserAndProvider(owner,"hilton"))!;
    expect(await balances.findByAccountId(account.id,10)).toHaveLength(1);
  });

  it("hard deletion cascades canonical memberships while soft deletion retains them", async () => {
    const account = createLoyaltyAccount({userId:owner,providerId:"citi-thankyou",membershipNumber:"cascade"});
    await accounts.insert(account);
    const goal = createTripGoal({userId:owner,title:"Retained goal",targetPoints:100,accountIds:[account.id]});
    await goals.insert(goal);
    await accounts.update({...account,deletedAt:clock.now()});
    expect((await goals.findById(goal.id))?.accountIds).toEqual([account.id]);
    await accounts.delete(account.id);
    expect((await goals.findById(goal.id))?.accountIds).toEqual([]);
    await goals.delete(goal.id);
  });
});
