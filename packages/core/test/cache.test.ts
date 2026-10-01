import { describe, expect, it } from "vitest";

import { InMemoryCache, userCacheTag } from "../src/application/cache";

const opts = { ttlMs: 1_000 };

describe("InMemoryCache", () => {
  it("returns stored values until the TTL elapses", async () => {
    let now = 0;
    const cache = new InMemoryCache({ now: () => now });
    await cache.set("k", 1, opts);
    expect(await cache.get("k")).toBe(1);
    now = 999;
    expect(await cache.get("k")).toBe(1);
    now = 1_000;
    expect(await cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry beyond maxEntries", async () => {
    const cache = new InMemoryCache({ maxEntries: 2 });
    await cache.set("a", 1, opts);
    await cache.set("b", 2, opts);
    await cache.get("a"); // refresh a; b is now oldest
    await cache.set("c", 3, opts);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe(1);
    expect(await cache.get("c")).toBe(3);
  });

  it("invalidates by tag without touching other tags", async () => {
    const cache = new InMemoryCache();
    await cache.set("a", 1, { ...opts, tags: [userCacheTag(asUserId("u1"))] });
    await cache.set("b", 2, { ...opts, tags: [userCacheTag(asUserId("u1"))] });
    await cache.set("c", 3, { ...opts, tags: [userCacheTag(asUserId("u2"))] });
    await cache.invalidateTag(userCacheTag(asUserId("u1")));
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("c")).toBe(3);
  });

  it("coalesces concurrent loads of one key", async () => {
    const cache = new InMemoryCache();
    let loads = 0;
    const loader = async () => {
      loads += 1;
      await Promise.resolve();
      return "value";
    };
    const results = await Promise.all([
      cache.remember("k", opts, loader),
      cache.remember("k", opts, loader),
      cache.remember("k", opts, loader),
    ]);
    expect(results).toEqual(["value", "value", "value"]);
    expect(loads).toBe(1);
    await cache.remember("k", opts, loader); // now a hit
    expect(loads).toBe(1);
  });

  it("does not store a value loaded across an invalidation", async () => {
    const cache = new InMemoryCache();
    const tags = [userCacheTag(asUserId("u"))];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const stale = cache.remember("k", { ...opts, tags }, async () => {
      await gate;
      return "stale";
    });
    await cache.invalidateTag(userCacheTag(asUserId("u"))); // a write commits mid-load
    // A read that starts after the write must run its own load.
    const fresh = await cache.remember("k", { ...opts, tags }, async () => "fresh");
    release();
    expect(await stale).toBe("stale"); // the in-flight caller keeps its result
    expect(fresh).toBe("fresh");
    expect(await cache.get("k")).toBe("fresh"); // ...but it was not cached over fresh
  });

  it("does not cache failed loads", async () => {
    const cache = new InMemoryCache();
    await expect(
      cache.remember("k", opts, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await cache.remember("k", opts, async () => "ok")).toBe("ok");
  });

  it("ttl <= 0 stores nothing", async () => {
    const cache = new InMemoryCache();
    await cache.set("k", 1, { ttlMs: 0 });
    expect(await cache.get("k")).toBeUndefined();
  });
});

import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";

import { asUserId } from "./ids";
describe("ListLoyaltyAccounts with a cache", () => {
  const setup = async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = createLoyaltyAccount({ userId: asUserId("u1"), providerId: "united", membershipNumber: "1" });
    await accounts.insert(account);
    await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 100, source: "manual" }));
    let reads = 0;
    const counting = Object.create(accounts) as typeof accounts;
    counting.findByUserId = (userId) => {
      reads += 1;
      return accounts.findByUserId(userId);
    };
    const cache = new InMemoryCache();
    const list = new ListLoyaltyAccounts(counting, balances, undefined, undefined, cache);
    return { list, cache, balances, account, reads: () => reads };
  };

  it("serves repeat reads from cache and hands out independent arrays", async () => {
    const { list, reads } = await setup();
    const a = await list.execute(asUserId("u1"));
    const b = await list.execute(asUserId("u1"));
    expect(reads()).toBe(1);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    a.pop();
    expect((await list.execute(asUserId("u1"))).length).toBe(1);
  });

  it("reflects new data after the user's tag is invalidated", async () => {
    const { list, cache, balances, account, reads } = await setup();
    expect((await list.execute(asUserId("u1")))[0]!.latestBalance?.points).toBe(100);
    await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 250, source: "manual", capturedAt: new Date(Date.now() + 60_000) }));
    expect((await list.execute(asUserId("u1")))[0]!.latestBalance?.points).toBe(100); // still cached
    await cache.invalidateTag(userCacheTag(asUserId("u1")));
    expect((await list.execute(asUserId("u1")))[0]!.latestBalance?.points).toBe(250);
    expect(reads()).toBe(2);
  });
});
