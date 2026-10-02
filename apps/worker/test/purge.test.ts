import type { RetentionStore } from "@pointup/core";
import { describe, expect, it } from "vitest";

import { purge, retentionPolicy } from "../src/jobs/purge";
import { loadEnv } from "../src/env";

const env = (extra: Record<string, string> = {}) => {
  const saved = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: "postgresql://u:p@localhost:5432/x", ...extra });
  try {
    return loadEnv();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
};

describe("retention policy from env", () => {
  it("defaults: 14 d outbox, 365 d activity, loop every hour", () => {
    const e = env();
    expect(e.WORKER_PURGE_INTERVAL_SECONDS).toBe(3600);
    expect(retentionPolicy(e)).toMatchObject({
      outboxRetentionDays: 14,
      activityRetentionDays: 365,
      accessTokenRetentionDays: 90,
      consentRetentionDays: 365,
      batchSize: 1000,
      maxRowsPerRun: 50000,
    });
  });

  it("is configurable", () => {
    const e = env({
      OUTBOX_RETENTION_DAYS: "7",
      ACTIVITY_RETENTION_DAYS: "30",
      PURGE_BATCH_SIZE: "50",
      PURGE_MAX_ROWS_PER_RUN: "500",
      WORKER_PURGE_INTERVAL_SECONDS: "60",
    });
    expect(e.WORKER_PURGE_INTERVAL_SECONDS).toBe(60);
    expect(retentionPolicy(e)).toMatchObject({
      outboxRetentionDays: 7,
      activityRetentionDays: 30,
      batchSize: 50,
      maxRowsPerRun: 500,
    });
  });
});

describe("purge job", () => {
  it("emits one structured log line with per-target counts", async () => {
    const left = { outbox: 3, activity: 1, access_tokens: 0, consents: 0 };
    const retention: RetentionStore = {
      purgeBatch: async (target, _cutoff, limit) => {
        const n = Math.min(limit, left[target]);
        left[target] -= n;
        return n;
      },
    };
    const lines: string[] = [];
    const result = await purge({ retention }, env(), (l) => lines.push(l), new Date("2026-10-01T00:00:00Z"));
    expect(result.deleted).toBe(4);
    expect(lines).toHaveLength(1);
    const log = JSON.parse(lines[0]!);
    expect(log).toMatchObject({
      level: "info",
      msg: "retention_purge",
      deleted: 4,
      targets: { outbox: { deleted: 3, capped: false }, activity: { deleted: 1 } },
    });
    expect(log.targets.outbox.cutoff).toBe("2026-09-17T00:00:00.000Z");
  });

  it("throws after purging the other targets when one fails", async () => {
    const seen: string[] = [];
    const retention: RetentionStore = {
      purgeBatch: async (target) => {
        seen.push(target);
        if (target === "outbox") throw new Error("db down");
        return 0;
      },
    };
    const lines: string[] = [];
    await expect(purge({ retention }, env(), (l) => lines.push(l))).rejects.toThrow("purge failed for: outbox");
    expect(seen).toEqual(["outbox", "activity", "access_tokens", "consents"]);
    expect(JSON.parse(lines[0]!).level).toBe("error");
  });
});
