import { describe, expect, it } from "vitest";
import { CheckAwardWatches } from "../src/application/loyalty/award-watches";
import { IngestDealPage } from "../src/application/loyalty/ingest-deal-page";
import type { Eventing } from "../src/application/events/ports";
import type { DomainEvent } from "../src/domain/events";
import { createAwardWatch, type AwardWatch } from "../src/domain/loyalty/award-watch";
import type { AwardWatchId } from "../src/domain/shared/ids";
import { InMemoryAwardWatchRepository } from "./fakes";
import { asUserId } from "./ids";

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
}
class LockedWatches extends InMemoryAwardWatchRepository {
  lockById(id: AwardWatchId) { return this.findById(id); }
}
async function fixture() {
  const repo = new LockedWatches(), events: DomainEvent[] = [];
  const watch = createAwardWatch({ userId: asUserId("watch-race-owner"), url: "https://synthetic.example/deals", label: "Fixture", minCentsPerPoint: 2, now: new Date("2026-10-02T11:00:00Z") });
  await repo.insert(watch);
  let tail = Promise.resolve();
  const eventing: Eventing = { publisher: { publish: async batch => { events.push(...batch); } }, unitOfWork: { atomic: true,
    async run(work) {
      const previous = tail, done = gate(); tail = done.wait;
      await previous;
      const rows = new Map(repo.rows), eventCount = events.length;
      try { return await work(); }
      catch (error) { repo.rows.clear(); for (const [id, row] of rows) repo.rows.set(id, row); events.splice(eventCount); throw error; }
      finally { done.release(); }
    },
  } };
  function checker({ cpp = 3, paused, entered, fail = false, now = "2026-10-02T12:01:00Z" }: { cpp?: number; paused?: ReturnType<typeof gate>; entered?: ReturnType<typeof gate>; fail?: boolean; now?: string } = {}) {
    const clock = { now: () => new Date(now) };
    const page = new IngestDealPage({ scrape: async url => {
      entered?.release(); if (paused) await paused.wait;
      if (fail) throw new Error("synthetic failure");
      return { url, title: "Fixture", markdown: `Hyatt 10,000 points or $${cpp * 100}`, fetchedAt: clock.now() };
    } }, clock);
    return new CheckAwardWatches(repo, page, clock, eventing);
  }
  return { repo, events, watch, eventing, checker };
}
describe("award watch transaction races", () => {
  it("a delayed failure preserves a newer success and cannot cause a duplicate hit", async () => {
    const f = await fixture(), paused = gate(), entered = gate();
    const slow = f.checker({ paused, entered, fail: true, now: "2026-10-02T12:00:00Z" }).execute();
    await entered.wait;
    expect((await f.checker().execute()).hits).toHaveLength(1);
    const success = await f.repo.findById(f.watch.id);
    paused.release(); expect(await slow).toEqual({ checked: 1, failed: 1, hits: [] });
    expect(await f.repo.findById(f.watch.id)).toEqual(success);
    expect((await f.checker().execute()).hits).toHaveLength(0);
    expect(f.events).toHaveLength(1);
  });
  it("concurrent identical results create one committed hit and event", async () => {
    const f = await fixture(), paused = gate(), first = gate(), second = gate();
    const a = f.checker({ paused, entered: first }).execute(), b = f.checker({ paused, entered: second }).execute();
    await Promise.all([first.wait, second.wait]); paused.release();
    const results = await Promise.all([a, b]);
    expect(results.reduce((sum, result) => sum + result.hits.length, 0)).toBe(1);
    expect(f.events).toHaveLength(1);
    expect((await f.repo.findById(f.watch.id))?.bestSeenCentsPerPoint).toBe(3);
  });
  it("a delayed lower observation cannot reduce a newer best or timestamps", async () => {
    const f = await fixture(), paused = gate(), entered = gate();
    const slow = f.checker({ cpp: 2.5, paused, entered, now: "2026-10-02T12:00:00Z" }).execute();
    await entered.wait; await f.checker().execute();
    const success = await f.repo.findById(f.watch.id);
    paused.release(); expect((await slow).hits).toHaveLength(0);
    expect(await f.repo.findById(f.watch.id)).toEqual(success);
    expect(f.events).toHaveLength(1);
  });
  it("deletion during scraping prevents state resurrection and ghost notifications", async () => {
    const f = await fixture(), paused = gate(), entered = gate();
    const check = f.checker({ paused, entered }).execute(); await entered.wait;
    await f.repo.delete(f.watch.id); paused.release();
    expect((await check).hits).toHaveLength(0);
    expect(await f.repo.findById(f.watch.id)).toBeNull(); expect(f.events).toEqual([]);
  });
  it.each(["userId", "url", "label", "minCentsPerPoint", "createdAt"] as const)("a changed %s invalidates a pending scrape, including failures", async field => {
    for (const fail of [false, true]) {
      const f = await fixture(), paused = gate(), entered = gate();
      const check = f.checker({ paused, entered, fail }).execute(); await entered.wait;
      const values: Pick<AwardWatch, typeof field> = { userId: asUserId("other-owner"), url: "https://synthetic.example/changed", label: "Changed", minCentsPerPoint: 4, createdAt: new Date("2026-10-02T11:30:00Z") };
      const changed = { ...f.watch, [field]: values[field] };
      await f.repo.update(changed); paused.release();
      expect((await check).hits).toHaveLength(0);
      expect(await f.repo.findById(f.watch.id)).toEqual(changed); expect(f.events).toEqual([]);
    }
  });
  it("a publication failure rolls state back and exposes no successful result", async () => {
    const f = await fixture(); f.eventing.publisher.publish = async () => { throw new Error("synthetic publication failure"); };
    await expect(f.checker().execute()).rejects.toThrow("synthetic publication failure");
    expect(await f.repo.findById(f.watch.id)).toEqual(f.watch); expect(f.events).toEqual([]);
  });
  it("rejects lock/UOW mismatches before scraping or mutating", async () => {
    const f = await fixture();
    const page = new IngestDealPage({ scrape: async () => { throw new Error("must not scrape"); } });
    await expect(new CheckAwardWatches(f.repo, page).execute()).rejects.toThrow("atomic unit of work");
    await expect(new CheckAwardWatches(new InMemoryAwardWatchRepository(), page, undefined, f.eventing).execute()).rejects.toThrow("watch locking");
    expect(await f.repo.findById(f.watch.id)).toEqual(f.watch); expect(f.events).toEqual([]);
  });
});
