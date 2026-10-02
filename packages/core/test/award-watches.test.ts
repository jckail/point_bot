import { describe, expect, it, vi } from "vitest";

import {
  CheckAwardWatches,
  CreateAwardWatch,
  DeleteAwardWatch,
} from "../src/application/loyalty/award-watches";
import { IngestDealPage } from "../src/application/loyalty/ingest-deal-page";
import {
  createAwardWatch,
  recordCheck,
  shouldNotify,
} from "../src/domain/loyalty/award-watch";
import {
  AwardWatchNotFoundError,
  InvalidAwardWatchError,
  InvalidScrapeUrlError,
} from "../src/domain/errors";
import type { PageScraper, ScrapedPage } from "../src/application/ports";
import { InMemoryAwardWatchRepository } from "./fakes";

import { asUserId } from "./ids";
const NOW = new Date("2026-07-09T12:00:00Z");
const clock = { now: () => NOW };

function watch(over: Partial<Parameters<typeof createAwardWatch>[0]> = {}) {
  return createAwardWatch({
    userId: asUserId("u1"),
    url: "https://blog.example/hyatt-sweet-spots",
    label: "Hyatt sweet spots",
    minCentsPerPoint: 2,
    now: NOW,
    ...over,
  });
}

/** Scraper whose markdown yields one deal at a chosen ¢/pt. */
function scraperAt(cpp: number): PageScraper {
  // 10,000 points for $ (cpp * 100) → realized cpp as requested.
  const dollars = (cpp * 10_000) / 100;
  const page: ScrapedPage = {
    url: "https://blog.example/hyatt-sweet-spots",
    title: "Sweet spots",
    markdown: `Park Hyatt: 10,000 points instead of $${dollars.toFixed(2)} at Hyatt`,
    fetchedAt: NOW,
  };
  return { scrape: async () => page };
}

const failingScraper: PageScraper = {
  scrape: async () => {
    throw new Error("blocked");
  },
};

describe("createAwardWatch / shouldNotify / recordCheck", () => {
  it("validates label, threshold, and url", () => {
    expect(() => watch({ label: " " })).toThrow(InvalidAwardWatchError);
    expect(() => watch({ minCentsPerPoint: 0 })).toThrow(InvalidAwardWatchError);
    expect(() => watch({ minCentsPerPoint: 101 })).toThrow(InvalidAwardWatchError);
    expect(() => watch({ url: "ftp://x" })).toThrow(InvalidScrapeUrlError);
    expect(() => watch({ url: "not a url" })).toThrow(InvalidScrapeUrlError);
  });

  it("fires on the first qualifying value, then only on improvement", () => {
    let w = watch(); // threshold 2¢/pt
    expect(shouldNotify(w, null)).toBe(false);
    expect(shouldNotify(w, 1.5)).toBe(false); // below threshold
    expect(shouldNotify(w, 2.4)).toBe(true); // first hit

    w = recordCheck(w, { bestRealizedCpp: 2.4, notified: true, now: NOW });
    expect(w.bestSeenCentsPerPoint).toBe(2.4);
    expect(w.lastNotifiedAt).toEqual(NOW);

    expect(shouldNotify(w, 2.4)).toBe(false); // same value: no re-ping
    expect(shouldNotify(w, 2.2)).toBe(false); // worse: no ping
    expect(shouldNotify(w, 3.1)).toBe(true); // improvement: ping again
  });
});

describe("CheckAwardWatches", () => {
  it("fires a hit at/above threshold and advances bookkeeping", async () => {
    const repo = new InMemoryAwardWatchRepository();
    await repo.insert(watch());
    const check = new CheckAwardWatches(
      repo,
      new IngestDealPage(scraperAt(2.5), clock),
      clock,
    );

    const first = await check.execute();
    expect(first).toMatchObject({ checked: 1, failed: 0 });
    expect(first.hits).toHaveLength(1);
    expect(first.hits[0]!.bestRealizedCpp).toBe(2.5);

    // Same page again → no new hit (no improvement), but still checked.
    const second = await check.execute();
    expect(second.hits).toHaveLength(0);
    const stored = (await repo.findAll())[0]!;
    expect(stored.bestSeenCentsPerPoint).toBe(2.5);
    expect(stored.lastCheckedAt).toEqual(NOW);
  });

  it.each([Number.POSITIVE_INFINITY, 2_147_484])("counts an invalid observed rate %s without changing state or publishing", async cpp => {
    const repo = new InMemoryAwardWatchRepository();
    const original = watch();
    await repo.insert(original);
    const ingest = new IngestDealPage(scraperAt(2.5), clock);
    vi.spyOn(ingest, "execute").mockResolvedValue({
      pageTitle: "Synthetic", markdownExcerpt: "", deals: [{
        id: "synthetic", kind: "scraped", title: "Award", summary: "Synthetic",
        providerId: "hyatt", pointsCost: 1, cashEquivalentCents: cpp,
        sourceUrl: "https://example.com/award", transferFromProviderId: null,
      }],
    });
    const publish = vi.fn(async () => {});
    const check = new CheckAwardWatches(repo, ingest, clock, {
      unitOfWork: { atomic: false, run: work => work() }, publisher: { publish },
    });
    expect(await check.execute()).toEqual({ checked: 1, failed: 1, hits: [] });
    expect(await repo.findAll()).toEqual([original]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("stays quiet below the threshold", async () => {
    const repo = new InMemoryAwardWatchRepository();
    await repo.insert(watch({ minCentsPerPoint: 3 }));
    const check = new CheckAwardWatches(
      repo,
      new IngestDealPage(scraperAt(2.5), clock),
      clock,
    );
    expect((await check.execute()).hits).toHaveLength(0);
  });

  it("counts scrape failures without aborting and still marks the check", async () => {
    const repo = new InMemoryAwardWatchRepository();
    await repo.insert(watch());
    const check = new CheckAwardWatches(
      repo,
      new IngestDealPage(failingScraper, clock),
      clock,
    );
    const result = await check.execute();
    expect(result).toMatchObject({ checked: 1, failed: 1 });
    expect((await repo.findAll())[0]!.lastCheckedAt).toEqual(NOW);
  });
});

describe("CreateAwardWatch / DeleteAwardWatch", () => {
  it("creates then deletes an owned watch; never another user's", async () => {
    const repo = new InMemoryAwardWatchRepository();
    const created = await new CreateAwardWatch(repo, clock).execute({
      userId: asUserId("u1"),
      url: "https://blog.example/deals",
      label: "Deals",
      minCentsPerPoint: 1.8004,
    });
    expect(created.minCentsPerPoint).toBe(1.8);
    expect((await repo.findByUserId(asUserId("u1")))[0]?.id).toBe(created.id);

    const del = new DeleteAwardWatch(repo);
    await expect(del.execute(asUserId("u2"), created.id)).rejects.toBeInstanceOf(
      AwardWatchNotFoundError,
    );
    await del.execute(asUserId("u1"), created.id);
    expect(await repo.findByUserId(asUserId("u1"))).toEqual([]);
  });
});
