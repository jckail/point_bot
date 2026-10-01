import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETENTION_POLICY,
  purgeExpired,
  retentionCutoffs,
  type RetentionStore,
  type RetentionTarget,
} from "../src/infrastructure/retention/retention";

const NOW = new Date("2026-10-01T00:00:00.000Z");

/** Store with a fixed number of purgeable rows per target. */
class FakeStore implements RetentionStore {
  readonly calls: { target: RetentionTarget; cutoff: Date; limit: number }[] = [];
  constructor(
    private readonly remaining: Record<RetentionTarget, number>,
    private readonly failing: RetentionTarget | null = null,
  ) {}

  async purgeBatch(target: RetentionTarget, cutoff: Date, limit: number) {
    this.calls.push({ target, cutoff, limit });
    if (target === this.failing) throw new Error("boom");
    const n = Math.min(limit, this.remaining[target]);
    this.remaining[target] -= n;
    return n;
  }
}

const rows = (n: number) => ({ outbox: n, activity: n, access_tokens: n, consents: n });

describe("retention policy", () => {
  it("computes per-target cutoffs from the defaults (14 d / 365 d / 90 d / 365 d)", () => {
    const c = retentionCutoffs(DEFAULT_RETENTION_POLICY, NOW);
    const days = (d: Date) => Math.round((NOW.getTime() - d.getTime()) / 86_400_000);
    expect([days(c.outbox), days(c.activity), days(c.access_tokens), days(c.consents)]).toEqual([
      14, 365, 90, 365,
    ]);
  });

  it("never names balance snapshots or agent observations as purge targets", async () => {
    const store = new FakeStore(rows(0));
    await purgeExpired(store, DEFAULT_RETENTION_POLICY, NOW);
    expect([...new Set(store.calls.map((c) => c.target))].sort()).toEqual([
      "access_tokens",
      "activity",
      "consents",
      "outbox",
    ]);
  });
});

describe("purgeExpired", () => {
  const policy = { ...DEFAULT_RETENTION_POLICY, batchSize: 100, maxRowsPerRun: 1_000 };

  it("drains each target in bounded batches and stops on a short batch", async () => {
    const store = new FakeStore(rows(250));
    const result = await purgeExpired(store, policy, NOW);
    expect(result.deleted).toBe(1_000);
    for (const t of result.targets) {
      expect(t).toMatchObject({ deleted: 250, batches: 3, capped: false });
    }
    expect(store.calls.every((c) => c.limit <= 100)).toBe(true);
  });

  it("caps the work of one run and reports that more remains", async () => {
    const store = new FakeStore(rows(5_000));
    const result = await purgeExpired(store, policy, NOW);
    for (const t of result.targets) {
      expect(t).toMatchObject({ deleted: 1_000, batches: 10, capped: true });
    }
    // The last batch never asks for more than the remaining budget.
    const small = await purgeExpired(new FakeStore(rows(5_000)), { ...policy, batchSize: 400, maxRowsPerRun: 1_000 }, NOW);
    expect(small.targets[0]).toMatchObject({ deleted: 1_000, batches: 3, capped: true });
  });

  it("an exact multiple of the batch size costs one extra empty probe, not a cap", async () => {
    const store = new FakeStore(rows(200));
    const result = await purgeExpired(store, policy, NOW);
    expect(result.targets[0]).toMatchObject({ deleted: 200, batches: 3, capped: false });
  });

  it("isolates a failing target and still purges the others", async () => {
    const store = new FakeStore(rows(10), "activity");
    const result = await purgeExpired(store, policy, NOW);
    const by = Object.fromEntries(result.targets.map((t) => [t.target, t]));
    expect(by.activity).toMatchObject({ deleted: 0, error: "boom" });
    expect(by.outbox).toMatchObject({ deleted: 10 });
    expect(by.consents).toMatchObject({ deleted: 10 });
    expect(result.deleted).toBe(30);
  });

  it("rejects nonsensical limits", async () => {
    await expect(
      purgeExpired(new FakeStore(rows(0)), { ...policy, batchSize: 0 }, NOW),
    ).rejects.toThrow(RangeError);
  });
});
