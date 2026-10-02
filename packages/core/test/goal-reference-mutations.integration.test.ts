import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { UpdateTripGoal } from "../src/application/loyalty/update-trip-goal";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { UnlinkLoyaltyAccount } from "../src/application/loyalty/update-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { ListTripGoals } from "../src/application/loyalty/list-trip-goals";
import type { Eventing } from "../src/application/events/ports";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { UserId } from "../src/domain/shared/ids";
import { createDb } from "../src/infrastructure/db/client";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";
import type { DrizzleUnitOfWork } from "../src/infrastructure/outbox/drizzle-outbox";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("goal reference mutation barriers on real PostgreSQL", () => {
  const prefix = `goal-ref-${randomUUID()}`, clock = { now: () => new Date("2026-10-02T12:00:00Z") };
  let db: ReturnType<typeof createDb>;
  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") throw new Error("Goal tests require dedicated loopback postgres/app.");
    db = createDb(url!, { max: 4 });
  });
  afterAll(async () => {
    if (!db) return;
    try {
      for (const table of ["trip_goal", "domain_event_outbox", "activity_event", "loyalty_account"]) {
        await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE user_id LIKE ${prefix + "%"}`);
      }
    } finally { await db.$client.end({ timeout: 5 }); }
  });
  async function fixture() {
    const userId = UserId.parse(`${prefix}-${randomUUID()}`);
    const writer = buildDrizzleRepositories(db), editor = buildDrizzleRepositories(db);
    const appName = `goal-editor-${randomUUID().slice(0, 12)}`;
    const uow = editor.eventing!.unitOfWork as DrizzleUnitOfWork;
    const eventing: Eventing = { publisher: editor.eventing!.publisher, unitOfWork: { atomic: true,
      run: work => uow.run(async () => { await uow.db.execute(sql`SELECT set_config('application_name', ${appName}, true)`); return work(); }),
    } };
    const { accountId } = await new LinkLoyaltyAccount(writer.loyaltyAccounts, writer.activity, clock, writer.eventing).execute({ userId, providerId: "united", membershipNumber: "fixture" });
    const goal = await new CreateTripGoal(writer.tripGoals, writer.loyaltyAccounts, writer.balanceSnapshots, clock, writer.eventing).execute({ userId, title: "Original", targetPoints: 1000, accountIds: [accountId], notes: "original note" });
    const create = new CreateTripGoal(editor.tripGoals, editor.loyaltyAccounts, editor.balanceSnapshots, clock, eventing);
    const update = new UpdateTripGoal(editor.tripGoals, editor.loyaltyAccounts, editor.balanceSnapshots, clock, eventing);
    return { userId, accountId, goal, writer, editor, appName, create, update };
  }
  async function waitBlocked(appName: string) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await db.$client<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=${appName} AND wait_event_type='Lock') AS blocked`;
      if (rows[0]?.blocked) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Expected goal editor to wait on an actual PostgreSQL lock");
  }
  async function behindCommit<T>(f: Awaited<ReturnType<typeof fixture>>, write: () => Promise<unknown>, edit: () => Promise<T>) {
    let ready!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const writer = f.writer.eventing!.unitOfWork.run(async () => { try { await write(); } finally { ready(); } await gate; })
      .then(() => ({ ok: true as const }), error => ({ error }));
    await started;
    const editor = edit().then(value => ({ value }), error => ({ error }));
    try { await waitBlocked(f.appName); release(); expect(await writer).toEqual({ ok: true }); return await editor; }
    finally { release(); await writer; await editor; }
  }
  it.each(["create", "update"] as const)("%s waiting behind committed unlink rejects the selected reference and emits no goal mutation", async kind => {
    const f = await fixture();
    const unlink = new UnlinkLoyaltyAccount(f.writer.loyaltyAccounts, f.writer.activity, clock, f.writer.eventing);
    const result = await behindCommit(f, () => unlink.execute(f.userId, f.accountId), () => kind === "create"
      ? f.create.execute({ userId: f.userId, title: "Must not exist", targetPoints: 1000, accountIds: [f.accountId] })
      : f.update.execute({ userId: f.userId, goalId: f.goal.id, accountIds: [f.accountId] }));
    expect(result).toMatchObject({ error: { code: "LOYALTY_ACCOUNT_NOT_FOUND" } });
    expect(await f.writer.tripGoals.findByUserId(f.userId)).toHaveLength(1);
    expect(await f.writer.tripGoals.findById(f.goal.id)).toMatchObject({ title: "Original", accountIds: [f.accountId] });
    const events = await db.$client`SELECT type FROM domain_event_outbox WHERE user_id=${f.userId} AND type='goal.updated'`;
    expect(events).toHaveLength(0);
  });
  it("concurrent disjoint patches retain the freshly committed omitted fields", async () => {
    const f = await fixture();
    const update = new UpdateTripGoal(f.writer.tripGoals, f.writer.loyaltyAccounts, f.writer.balanceSnapshots, clock, f.writer.eventing);
    const result = await behindCommit(f, () => update.execute({ userId: f.userId, goalId: f.goal.id, notes: "committed note" }),
      () => f.update.execute({ userId: f.userId, goalId: f.goal.id, title: "New title" }));
    expect(result).toMatchObject({ value: { title: "New title", notes: "committed note", accountIds: [f.accountId] } });
    expect(await f.writer.tripGoals.findById(f.goal.id)).toMatchObject({ title: "New title", notes: "committed note" });
  });
  it("omitted references do not reacquire account FK locks or replace memberships", async () => {
    const f = await fixture();
    let ready!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const held = f.writer.eventing!.unitOfWork.run(async () => { await f.writer.loyaltyAccounts.lockById!(f.accountId); ready(); await gate; });
    await started;
    const update = f.update.execute({ userId: f.userId, goalId: f.goal.id, title: "Metadata only" });
    try {
      const result = await Promise.race([update, new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error("Metadata edit waited on unchanged account reference")), 1500); timer.unref(); update.finally(() => clearTimeout(timer)).catch(() => {}); })]);
      expect(result.accountIds).toEqual([f.accountId]);
    } finally { release(); await held; await update.catch(() => {}); }
  });
  it.each(["create", "update"] as const)("%s duplicate references agrees with persisted memberships and later reads", async kind => {
    const f = await fixture();
    await new RecordManualBalance(f.writer.loyaltyAccounts, f.writer.balanceSnapshots, f.writer.activity, clock, f.writer.eventing)
      .execute({ userId: f.userId, accountId: f.accountId, points: 600 });
    const result = kind === "create"
      ? await f.create.execute({ userId: f.userId, title: "Canonical", targetPoints: 1000, accountIds: [f.accountId, f.accountId] })
      : await f.update.execute({ userId: f.userId, goalId: f.goal.id, accountIds: [f.accountId, f.accountId] });
    expect(result).toMatchObject({ accountIds: [f.accountId], currentPoints: 600, remainingPoints: 400, achieved: false });
    const rows = await db.$client`SELECT account_id,position FROM trip_goal_account WHERE goal_id=${result.id}`;
    expect(rows).toEqual([{ account_id: f.accountId, position: 0 }]);
    const listed = await new ListTripGoals(f.editor.tripGoals, f.editor.balanceSnapshots).execute(f.userId);
    expect(listed.find(goal => goal.id === result.id)).toMatchObject({ accountIds: [f.accountId], currentPoints: 600, remainingPoints: 400, achieved: false });
  });
});
