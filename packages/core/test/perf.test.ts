import { describe, expect, it } from "vitest";

import { findSkill, AGENT_SKILL_CATALOG } from "../src/domain/agent/skill";
import {
  PROVIDER_CATALOG,
  findProvider,
  getProviderOrThrow,
} from "../src/domain/loyalty/provider";
import { computeBalanceTrend, buildTrendContext } from "../src/application/loyalty/balance-trend";
import { computePortfolioSummary } from "../src/application/loyalty/get-portfolio-summary";
import { toLoyaltyAccountReadModel } from "../src/application/loyalty/mappers";
import { InMemoryCache } from "../src/application/cache";
import type { BalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import type { LoyaltyAccount } from "../src/domain/loyalty/loyalty-account";

/**
 * Lightweight performance regression guards. No DB, no HTTP. They assert
 * generous absolute budgets (~50-100x what a laptop needs) and *ratios*
 * against a baseline measured in the same process, so a slow CI box does not
 * flake them but an accidental O(n^2) or per-call allocation blowup does.
 * Real measurements live in scripts/bench (see docs/performance.md).
 */

/** Median of `runs` timings of `fn` (ms); median shrugs off GC/scheduler spikes. */
function medianMs(fn: () => void, runs = 7): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
}

const now = new Date("2026-06-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function portfolio(size: number) {
  const providers = PROVIDER_CATALOG.slice(0, size);
  const accounts: LoyaltyAccount[] = providers.map((p, i) => ({
    id: `acc-${i}`,
    userId: "u",
    providerId: p.id,
    membershipNumber: `M${i}`,
    credentialRef: null,
    expiresAt: new Date(now.getTime() + (i % 40) * 10 * DAY),
    notes: null,
    tags: ["travel"],
    pinnedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
  const history = (i: number): BalanceSnapshot[] =>
    Array.from({ length: 200 }, (_, k) => ({
      id: `s-${i}-${k}`,
      loyaltyAccountId: `acc-${i}`,
      points: 1000 + k * 10,
      source: "sync" as const,
      capturedAt: new Date(now.getTime() - k * 2 * DAY),
    }));
  return { accounts, history };
}

describe("perf: catalog lookups", () => {
  it("findProvider is O(1): ~190-entry catalog costs no more than a handful of hits", () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    const first = ids[0]!;
    const last = ids[ids.length - 1]!;
    const lookups = 20_000;
    const loop = (id: string) => () => {
      for (let i = 0; i < lookups; i++) findProvider(id);
    };
    const hitFirst = medianMs(loop(first));
    const hitLast = medianMs(loop(last));
    // A linear scan makes the last id ~catalog-size times slower than the first.
    expect(hitLast).toBeLessThan(Math.max(hitFirst * 8, 15));
    // Absolute: 20k lookups must be far under a frame budget even on slow CI.
    expect(hitLast).toBeLessThan(250);
    expect(getProviderOrThrow(last).id).toBe(last);
    expect(findProvider("nope-not-a-provider")).toBeUndefined();
  });

  it("findSkill resolves every skill id in O(1)", () => {
    const ids = AGENT_SKILL_CATALOG.map((s) => s.id);
    expect(ids.length).toBeGreaterThan(0);
    const t = medianMs(() => {
      for (let n = 0; n < 50; n++) for (const id of ids) findSkill(id);
    });
    expect(t).toBeLessThan(250);
    for (const id of ids) expect(findSkill(id)?.id).toBe(id);
  });
});

describe("perf: pure read-path computation (60-account portfolio)", () => {
  const { accounts, history } = portfolio(Math.min(60, PROVIDER_CATALOG.length));

  it("builds trends + read models + summary within budget", () => {
    expect(accounts.length).toBeGreaterThanOrEqual(50);
    const run = () => {
      const models = accounts.map((account, i) =>
        toLoyaltyAccountReadModel(
          account,
          buildTrendContext(history(i), now),
          now,
        ),
      );
      return computePortfolioSummary(models);
    };
    const summary = run();
    expect(summary.accountCount).toBe(accounts.length);
    // Budget is dominated by building 12,000 fixture snapshots; the compute
    // itself is sub-millisecond. 1.5s is ~100x typical.
    expect(medianMs(run, 5)).toBeLessThan(1_500);
  });

  it("summary fold is linear in accounts (4x accounts <= ~12x time incl. noise)", () => {
    const small = portfolio(Math.min(15, PROVIDER_CATALOG.length));
    const big = portfolio(Math.min(60, PROVIDER_CATALOG.length));
    const toModels = (p: ReturnType<typeof portfolio>) =>
      p.accounts.map((a, i) =>
        toLoyaltyAccountReadModel(a, { latest: p.history(i)[0]!, previous: null, asOf30Days: null, asOf90Days: null }, now),
      );
    const smallModels = toModels(small);
    const bigModels = toModels(big);
    const reps = 2_000;
    const tSmall = medianMs(() => {
      for (let i = 0; i < reps; i++) computePortfolioSummary(smallModels);
    });
    const tBig = medianMs(() => {
      for (let i = 0; i < reps; i++) computePortfolioSummary(bigModels);
    });
    expect(tBig).toBeLessThan(Math.max(tSmall * 12, 20));
    expect(tBig).toBeLessThan(1_000);
  });

  it("trend reduction touches the history once (no quadratic rescans)", () => {
    const h200 = portfolio(1).history(0);
    const h2000 = Array.from({ length: 2_000 }, (_, k) => ({
      ...h200[0]!,
      id: `x-${k}`,
      capturedAt: new Date(now.getTime() - k * DAY),
    }));
    const t200 = medianMs(() => {
      for (let i = 0; i < 500; i++) computeBalanceTrend(buildTrendContext(h200, now));
    });
    const t2000 = medianMs(() => {
      for (let i = 0; i < 500; i++) computeBalanceTrend(buildTrendContext(h2000, now));
    });
    // 10x the history, but the 30/90-day probes stop early: nowhere near 100x.
    expect(t2000).toBeLessThan(Math.max(t200 * 40, 30));
  });
});

describe("perf: cache hit path", () => {
  it("serves 50k hits from a 1k-entry cache well under budget", async () => {
    const cache = new InMemoryCache({ maxEntries: 1_000 });
    for (let i = 0; i < 1_000; i++) await cache.set(`k${i}`, { i }, { ttlMs: 60_000, tags: [`user:${i % 50}`] });
    const start = performance.now();
    for (let i = 0; i < 50_000; i++) await cache.get(`k${i % 1_000}`);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});
