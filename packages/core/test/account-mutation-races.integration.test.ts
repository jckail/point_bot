import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { UpdateLoyaltyAccount, UnlinkLoyaltyAccount } from "../src/application/loyalty/update-loyalty-account";
import { RestoreLoyaltyAccount } from "../src/application/loyalty/restore-loyalty-account";
import { ImportPortfolio } from "../src/application/loyalty/import-portfolio";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import type { Eventing } from "../src/application/events/ports";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { UserId } from "../src/domain/shared/ids";
import { createDb } from "../src/infrastructure/db/client";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";
import type { DrizzleUnitOfWork } from "../src/infrastructure/outbox/drizzle-outbox";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("account mutation races on real PostgreSQL", () => {
  const prefix = `account-race-${randomUUID()}`;
  const clock = { now: () => new Date("2026-10-02T12:00:00Z") };
  let db: ReturnType<typeof createDb>;
  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") throw new Error("Race tests require dedicated loopback postgres/app.");
    db = createDb(url!, { max: 4 });
  });
  afterAll(async () => {
    if (!db) return;
    try {
      for (const table of ["domain_event_outbox", "activity_event", "loyalty_account"]) await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE user_id LIKE ${prefix + "%"}`);
    } finally { await db.$client.end({ timeout: 5 }); }
  });
  async function fixture() {
    const userId = UserId.parse(`${prefix}-${randomUUID()}`);
    const writer = buildDrizzleRepositories(db), editor = buildDrizzleRepositories(db);
    const appName = `account-editor-${randomUUID().slice(0, 12)}`;
    const uow = editor.eventing!.unitOfWork as DrizzleUnitOfWork;
    const eventing: Eventing = { publisher: editor.eventing!.publisher, unitOfWork: { atomic: true,
      run: work => uow.run(async () => { await uow.db.execute(sql`SELECT set_config('application_name', ${appName}, true)`); return work(); }),
    } };
    const { accountId } = await new LinkLoyaltyAccount(writer.loyaltyAccounts, writer.activity, clock, writer.eventing).execute({ userId, providerId: "chase-ultimate-rewards", membershipNumber: "original", cardProductId: "chase-sapphire-preferred" });
    const writerUpdate = new UpdateLoyaltyAccount(writer.loyaltyAccounts, writer.activity, clock, writer.eventing);
    const editorUpdate = new UpdateLoyaltyAccount(editor.loyaltyAccounts, editor.activity, clock, eventing);
    return { userId, accountId, writer, editor, eventing, appName, writerUpdate, editorUpdate };
  }
  async function waitBlocked(appName: string) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await db.$client<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=${appName} AND wait_event_type='Lock') AS blocked`;
      if (rows[0]?.blocked) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Expected editor to wait on a real PostgreSQL lock");
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
  async function countEvents(userId: UserId, type: string) {
    const rows = await db.$client<{ n: number }[]>`SELECT count(*)::int AS n FROM domain_event_outbox WHERE user_id=${userId} AND type=${type}`;
    return rows[0]!.n;
  }
  it("an edit waiting behind unlink cannot resurrect the account or emit an update", async () => {
    const f = await fixture();
    const unlink = new UnlinkLoyaltyAccount(f.writer.loyaltyAccounts, f.writer.activity, clock, f.writer.eventing);
    const result = await behindCommit(f, () => unlink.execute(f.userId, f.accountId), () => f.editorUpdate.execute({ userId: f.userId, accountId: f.accountId, cardProductId: "chase-sapphire-reserve", notes: "must not be applied" }));
    expect(result).toMatchObject({ error: { code: "LOYALTY_ACCOUNT_NOT_FOUND" } });
    expect(await f.writer.loyaltyAccounts.findById(f.accountId)).toMatchObject({ deletedAt: expect.any(Date), cardProductId: "chase-sapphire-preferred", notes: null });
    expect(await countEvents(f.userId, "account.updated")).toBe(0);
    expect(await countEvents(f.userId, "account.unlinked")).toBe(1);
    expect(await db.$client`SELECT id FROM activity_event WHERE user_id=${f.userId} AND type='account_updated'`).toHaveLength(0);
  });
  it("a delayed patch uses current omitted metadata and card selection", async () => {
    const f = await fixture();
    const result = await behindCommit(f, () => f.writerUpdate.execute({ userId: f.userId, accountId: f.accountId, notes: "new current note", tags: ["current"], cardProductId: "chase-sapphire-reserve" }), () => f.editorUpdate.execute({ userId: f.userId, accountId: f.accountId, membershipNumber: "new-member" }));
    expect(result).toEqual({ value: undefined });
    expect(await f.writer.loyaltyAccounts.findById(f.accountId)).toMatchObject({ membershipNumber: "new-member", notes: "new current note", tags: ["current"], cardProductId: "chase-sapphire-reserve", deletedAt: null });
    expect(await countEvents(f.userId, "account.updated")).toBe(2);
  });
  it("unlink waiting behind an edit retains edited metadata", async () => {
    const f = await fixture();
    const unlink = new UnlinkLoyaltyAccount(f.editor.loyaltyAccounts, f.editor.activity, clock, f.eventing);
    const result = await behindCommit(f, () => f.writerUpdate.execute({ userId: f.userId, accountId: f.accountId, notes: "retain on unlink", tags: ["current"] }), () => unlink.execute(f.userId, f.accountId));
    expect(result).toEqual({ value: undefined });
    expect(await f.writer.loyaltyAccounts.findById(f.accountId)).toMatchObject({ notes: "retain on unlink", tags: ["current"], deletedAt: expect.any(Date) });
  });
  it("competing restores emit exactly one restore and reject the stale second request", async () => {
    const f = await fixture();
    await new UnlinkLoyaltyAccount(f.writer.loyaltyAccounts, f.writer.activity, clock, f.writer.eventing).execute(f.userId, f.accountId);
    const writer = new RestoreLoyaltyAccount(f.writer.loyaltyAccounts, f.writer.balanceSnapshots, f.writer.activity, clock, f.writer.eventing);
    const editor = new RestoreLoyaltyAccount(f.editor.loyaltyAccounts, f.editor.balanceSnapshots, f.editor.activity, clock, f.eventing);
    const result = await behindCommit(f, () => writer.execute(f.userId, f.accountId), () => editor.execute(f.userId, f.accountId));
    expect(result).toMatchObject({ error: { code: "ACCOUNT_NOT_RESTORABLE" } });
    expect((await f.writer.loyaltyAccounts.findById(f.accountId))!.deletedAt).toBeNull();
    expect(await countEvents(f.userId, "account.restored")).toBe(1);
  });
  it("CSV import waiting behind a selection edit rejects the conflict without writing any other program", async () => {
    const f = await fixture();
    const record = new RecordManualBalance(f.editor.loyaltyAccounts, f.editor.balanceSnapshots, f.editor.activity, clock, f.eventing);
    const link = new LinkLoyaltyAccount(f.editor.loyaltyAccounts, f.editor.activity, clock, f.eventing);
    const importer = new ImportPortfolio(f.editor.loyaltyAccounts, link, record, clock, f.eventing);
    const csv = "providerId,membershipNumber,points,capturedAt,cardProductId\naer-lingus-aerclub,new,10000,,\nchase-ultimate-rewards,original,40000,,chase-sapphire-preferred";
    const result = await behindCommit(f, () => f.writerUpdate.execute({ userId: f.userId, accountId: f.accountId, cardProductId: "chase-sapphire-reserve" }), () => importer.execute({ userId: f.userId, csv }));
    expect(result).toMatchObject({ error: { code: "INVALID_IMPORT" } });
    expect(await f.writer.loyaltyAccounts.findByUserAndProvider(f.userId, "aer-lingus-aerclub")).toBeNull();
    expect((await f.writer.loyaltyAccounts.findById(f.accountId))!.cardProductId).toBe("chase-sapphire-reserve");
    expect(await f.writer.balanceSnapshots.findLatestByAccountIds([f.accountId])).toEqual(new Map());
    expect(await countEvents(f.userId, "account.linked")).toBe(1);
    expect(await countEvents(f.userId, "balance.recorded")).toBe(0);
  });
});
