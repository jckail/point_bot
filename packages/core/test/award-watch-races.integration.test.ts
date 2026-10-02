import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckAwardWatches } from "../src/application/loyalty/award-watches";
import { IngestDealPage } from "../src/application/loyalty/ingest-deal-page";
import type { Eventing } from "../src/application/events/ports";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { createAwardWatch, type AwardWatchRepository } from "../src/domain/loyalty/award-watch";
import { UserId } from "../src/domain/shared/ids";
import { createDb } from "../src/infrastructure/db/client";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";
import type { DrizzleUnitOfWork } from "../src/infrastructure/outbox/drizzle-outbox";

// Root owns the migrated, dedicated fixture. Never create/adopt schema here.
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("award watch races on real PostgreSQL", () => {
  const prefix = `watch-race-${randomUUID()}`;
  let db: ReturnType<typeof createDb>;
  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") throw new Error("Watch race tests require dedicated loopback postgres/app.");
    db = createDb(url!, { max: 4 });
  });
  afterAll(async () => {
    if (!db) return;
    try {
      for (const table of ["domain_event_outbox", "award_watch"]) await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE user_id LIKE ${prefix + "%"}`);
    } finally { await db.$client.end({ timeout: 5 }); }
  });
  async function fixture() {
    const userId = UserId.parse(`${prefix}-${randomUUID()}`);
    const writer = buildDrizzleRepositories(db), editor = buildDrizzleRepositories(db);
    const watch = createAwardWatch({ userId, url: "https://synthetic.example/watch", label: "Race fixture", minCentsPerPoint: 2, now: new Date("2026-10-02T11:00:00Z") });
    await writer.awardWatches.insert(watch);
    const appName = `watch-editor-${randomUUID().slice(0, 12)}`;
    const uow = editor.eventing!.unitOfWork as DrizzleUnitOfWork;
    const eventing: Eventing = { publisher: editor.eventing!.publisher, unitOfWork: { atomic: true,
      run: work => uow.run(async () => { await uow.db.execute(sql`SELECT set_config('application_name', ${appName}, true)`); return work(); }),
    } };
    function scoped(repo: AwardWatchRepository): AwardWatchRepository {
      return { findAll: () => repo.findByUserId(userId), findById: id => repo.findById(id), lockById: id => repo.lockById!(id),
        findByUserId: id => repo.findByUserId(id), insert: row => repo.insert(row), update: row => repo.update(row), delete: id => repo.delete(id) };
    }
    function checker(repo: AwardWatchRepository, events: Eventing, fail = false, timestamp = "2026-10-02T12:01:00Z") {
      const clock = { now: () => new Date(timestamp) };
      const page = new IngestDealPage({ scrape: async pageUrl => {
        if (fail) throw new Error("synthetic failure");
        return { url: pageUrl, title: "Fixture", markdown: "Hyatt 10,000 points or $300", fetchedAt: clock.now() };
      } }, clock);
      return new CheckAwardWatches(scoped(repo), page, clock, events);
    }
    return { userId, watch, writer, editor, eventing, appName,
      writerCheck: checker(writer.awardWatches, writer.eventing!),
      editorCheck: checker(editor.awardWatches, eventing),
      failedCheck: checker(editor.awardWatches, eventing, true, "2026-10-02T12:00:00Z"),
    };
  }
  async function waitBlocked(appName: string) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await db.$client<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=${appName} AND wait_event_type='Lock') AS blocked`;
      if (rows[0]?.blocked) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Expected watch check to wait on a real PostgreSQL lock");
  }
  async function behindCommit<T>(f: Awaited<ReturnType<typeof fixture>>, write: () => Promise<unknown>, check: () => Promise<T>) {
    let ready!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const writer = f.writer.eventing!.unitOfWork.run(async () => { try { await write(); } finally { ready(); } await gate; })
      .then(() => ({ ok: true as const }), error => ({ error }));
    await started;
    const checker = check().then(value => ({ value }), error => ({ error }));
    try { await waitBlocked(f.appName); release(); expect(await writer).toEqual({ ok: true }); return await checker; }
    finally { release(); await writer; await checker; }
  }
  async function eventCount(userId: UserId) {
    const rows = await db.$client<{ n: number }[]>`SELECT count(*)::int AS n FROM domain_event_outbox WHERE user_id=${userId} AND type='watch.triggered'`;
    return rows[0]!.n;
  }
  it("identical successes waiting on the real row lock commit one event", async () => {
    const f = await fixture();
    const result = await behindCommit(f, async () => { expect((await f.writerCheck.execute()).hits).toHaveLength(1); }, () => f.editorCheck.execute());
    expect(result).toEqual({ value: { checked: 1, failed: 0, hits: [] } });
    expect(await eventCount(f.userId)).toBe(1);
    expect(await f.writer.awardWatches.findById(f.watch.id)).toMatchObject({ bestSeenCentsPerPoint: 3, lastNotifiedAt: new Date("2026-10-02T12:01:00Z") });
  });
  it("an older failure waiting behind success retains the current best and timestamps", async () => {
    const f = await fixture();
    const result = await behindCommit(f, () => f.writerCheck.execute(), () => f.failedCheck.execute());
    expect(result).toEqual({ value: { checked: 1, failed: 1, hits: [] } });
    expect(await f.writer.awardWatches.findById(f.watch.id)).toMatchObject({ bestSeenCentsPerPoint: 3, lastNotifiedAt: new Date("2026-10-02T12:01:00Z"), lastCheckedAt: new Date("2026-10-02T12:01:00Z"), updatedAt: new Date("2026-10-02T12:01:00Z") });
    expect((await f.writerCheck.execute()).hits).toHaveLength(0);
    expect(await eventCount(f.userId)).toBe(1);
  });
  it("a deletion holding the row lock prevents a stale notification or resurrection", async () => {
    const f = await fixture();
    const result = await behindCommit(f, () => f.writer.awardWatches.delete(f.watch.id), () => f.editorCheck.execute());
    expect(result).toEqual({ value: { checked: 1, failed: 0, hits: [] } });
    expect(await f.writer.awardWatches.findById(f.watch.id)).toBeNull(); expect(await eventCount(f.userId)).toBe(0);
  });
  it("a changed URL and threshold holding the row lock invalidate the scraped configuration", async () => {
    const f = await fixture();
    const changed = { ...f.watch, url: "https://synthetic.example/changed", minCentsPerPoint: 4 };
    const result = await behindCommit(f, () => f.writer.awardWatches.update(changed), () => f.editorCheck.execute());
    expect(result).toEqual({ value: { checked: 1, failed: 0, hits: [] } });
    expect(await f.writer.awardWatches.findById(f.watch.id)).toEqual(changed); expect(await eventCount(f.userId)).toBe(0);
  });
});
