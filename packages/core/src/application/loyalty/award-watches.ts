import { createDomainEvent } from "../../domain/events";
import { noopEventing, type Eventing } from "../events/ports";
import { AwardWatchNotFoundError, InvalidAwardWatchError } from "../../domain/errors";
import {
  createAwardWatch,
  recordCheck,
  normalizeObservedCentsPerPoint,
  shouldNotify,
  type AwardWatch,
  type AwardWatchRepository,
} from "../../domain/loyalty/award-watch";
import { realizedCpp } from "../../domain/loyalty/deals";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { IngestDealPage } from "./ingest-deal-page";

import type { AwardWatchId, UserId } from "../../domain/shared/ids";
export class CreateAwardWatch {
  constructor(
    private readonly watches: AwardWatchRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(input: {
    readonly userId: UserId;
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

  execute(userId: UserId): Promise<AwardWatch[]> {
    return this.watches.findByUserId(userId);
  }
}

export class DeleteAwardWatch {
  constructor(private readonly watches: AwardWatchRepository) {}

  async execute(userId: UserId, watchId: AwardWatchId): Promise<void> {
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
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(): Promise<CheckAwardWatchesResult> {
    if (Boolean(this.watches.lockById) !== this.eventing.unitOfWork.atomic) {
      throw new Error("Award watch checks require an atomic unit of work and watch locking");
    }
    const all = await this.watches.findAll();
    const hits: AwardWatchHit[] = [];
    let failed = 0;

    for (const watch of all) {
      let best: { cpp: number; title: string } | null = null;
      let pageTitle = "";

      try {
        const result = await this.ingestDealPage.execute({ url: watch.url });
        pageTitle = result.pageTitle;
        for (const deal of result.deals) {
          const cpp = normalizeObservedCentsPerPoint(realizedCpp(deal));
          if (cpp !== null && (best === null || cpp > best.cpp)) {
            best = { cpp, title: deal.title };
          }
        }
      } catch (error) {
        failed += 1;
        // Invalid numeric claims must not change bookkeeping or publish a hit.
        if (error instanceof InvalidAwardWatchError) continue;
        best = null;
      }

      const hit = await this.eventing.unitOfWork.run(async (): Promise<AwardWatchHit | null> => {
        const current = this.watches.lockById
          ? await this.watches.lockById(watch.id)
          : await this.watches.findById(watch.id);
        // Observation bookkeeping may change while scraping. Configuration and
        // ownership changes invalidate the scrape; deletion must not notify.
        if (!current || current.userId !== watch.userId || current.url !== watch.url
          || current.label !== watch.label || current.minCentsPerPoint !== watch.minCentsPerPoint
          || current.createdAt.getTime() !== watch.createdAt.getTime()) return null;
        const now = new Date(Math.max(this.clock.now().getTime(), current.updatedAt.getTime(),
          current.lastCheckedAt?.getTime() ?? 0, current.lastNotifiedAt?.getTime() ?? 0));
        const notified = shouldNotify(current, best?.cpp ?? null);
        await this.watches.update(
          recordCheck(current, {
            bestRealizedCpp: best?.cpp ?? null,
            notified,
            now,
          }),
        );
        if (notified && best) {
          await this.eventing.publisher.publish([
            createDomainEvent("watch.triggered", {
              userId: current.userId,
              aggregateId: current.id,
              occurredAt: now,
              payload: {
                bestRealizedCpp: best.cpp,
                minCentsPerPoint: current.minCentsPerPoint,
              },
            }),
          ]);
          return { watch: current, bestRealizedCpp: best.cpp, bestDealTitle: best.title, pageTitle };
        }
        return null;
      });
      if (hit) hits.push(hit);
    }

    return { checked: all.length, failed, hits };
  }
}
