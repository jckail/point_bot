import { AwardWatchNotFoundError } from "../../domain/errors";
import {
  createAwardWatch,
  recordCheck,
  shouldNotify,
  type AwardWatch,
  type AwardWatchRepository,
} from "../../domain/loyalty/award-watch";
import { realizedCpp } from "../../domain/loyalty/deals";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { IngestDealPage } from "./ingest-deal-page";

export class CreateAwardWatch {
  constructor(
    private readonly watches: AwardWatchRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(input: {
    readonly userId: string;
    readonly url: string;
    readonly label: string;
    readonly minCentsPerPoint: number;
  }): Promise<AwardWatch> {
    const watch = createAwardWatch({ ...input, now: this.clock.now() });
    await this.watches.insert(watch);
    return watch;
  }
}

export class ListAwardWatches {
  constructor(private readonly watches: AwardWatchRepository) {}

  execute(userId: string): Promise<AwardWatch[]> {
    return this.watches.findByUserId(userId);
  }
}

export class DeleteAwardWatch {
  constructor(private readonly watches: AwardWatchRepository) {}

  async execute(userId: string, watchId: string): Promise<void> {
    const watch = await this.watches.findById(watchId);
    // Same never-distinguishable contract as accounts/goals: absent and
    // not-yours both read as not found.
    if (!watch || watch.userId !== userId) {
      throw new AwardWatchNotFoundError(watchId);
    }
    await this.watches.delete(watchId);
  }
}

/** A watch that fired during a check run, ready for delivery surfaces. */
export interface AwardWatchHit {
  readonly watch: AwardWatch;
  readonly bestRealizedCpp: number;
  /** Title of the best-value deal found on the page. */
  readonly bestDealTitle: string;
  readonly pageTitle: string;
}

export interface CheckAwardWatchesResult {
  readonly checked: number;
  readonly failed: number;
  readonly hits: AwardWatchHit[];
}

/**
 * Worker loop: re-scrape every watch's page (via the existing IngestDealPage
 * use case, so extraction heuristics live in one place), find the best
 * realized ¢/pt among the extracted deals, and fire a hit when the watch's
 * threshold is met and the value improves on what was seen before. Scrape
 * failures are counted but never abort the run; bookkeeping still advances so
 * a permanently broken page doesn't look "never checked".
 */
export class CheckAwardWatches {
  constructor(
    private readonly watches: AwardWatchRepository,
    private readonly ingestDealPage: IngestDealPage,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(): Promise<CheckAwardWatchesResult> {
    const all = await this.watches.findAll();
    const hits: AwardWatchHit[] = [];
    let failed = 0;

    for (const watch of all) {
      const now = this.clock.now();
      let best: { cpp: number; title: string } | null = null;
      let pageTitle = "";

      try {
        const result = await this.ingestDealPage.execute({ url: watch.url });
        pageTitle = result.pageTitle;
        for (const deal of result.deals) {
          const cpp = realizedCpp(deal);
          if (cpp !== null && (best === null || cpp > best.cpp)) {
            best = { cpp, title: deal.title };
          }
        }
      } catch {
        failed += 1;
        await this.watches.update(
          recordCheck(watch, { bestRealizedCpp: null, notified: false, now }),
        );
        continue;
      }

      const notified = shouldNotify(watch, best?.cpp ?? null);
      if (notified && best) {
        hits.push({
          watch,
          bestRealizedCpp: best.cpp,
          bestDealTitle: best.title,
          pageTitle,
        });
      }
      await this.watches.update(
        recordCheck(watch, {
          bestRealizedCpp: best?.cpp ?? null,
          notified,
          now,
        }),
      );
    }

    return { checked: all.length, failed, hits };
  }
}
