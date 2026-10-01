import { InMemoryCache, userCacheTag } from "@pointup/core";
import { describe, expect, it } from "vitest";

import { invalidateOnWrite } from "./read-cache";

describe("invalidateOnWrite", () => {
  const build = () => {
    const cache = new InMemoryCache();
    const calls: string[] = [];
    // Fakes take arguments like real use cases (`execute(userId | { userId })`).
    const useCases = {
      listLoyaltyAccounts: {
        execute: async (_input: unknown) => calls.push("list"),
      },
      linkLoyaltyAccount: { execute: async (_input: unknown) => "linked" },
      setCustomValuation: {
        execute: async (_input: unknown) => {
          throw new Error("partial failure");
        },
      },
      notAUseCase: 42,
    };
    return { cache, calls, wrapped: invalidateOnWrite(useCases, cache) };
  };

  it("drops the caller's tag after a write, leaving other users alone", async () => {
    const { cache, wrapped } = build();
    await cache.set("a", 1, { ttlMs: 60_000, tags: [userCacheTag("u1")] });
    await cache.set("b", 2, { ttlMs: 60_000, tags: [userCacheTag("u2")] });
    expect(await wrapped.linkLoyaltyAccount.execute({ userId: "u1" })).toBe("linked");
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBe(2);
  });

  it("also invalidates when the write fails part-way", async () => {
    const { cache, wrapped } = build();
    await cache.set("a", 1, { ttlMs: 60_000, tags: [userCacheTag("u1")] });
    await expect(wrapped.setCustomValuation.execute({ userId: "u1" })).rejects.toThrow();
    expect(await cache.get("a")).toBeUndefined();
  });

  it("leaves read use cases untouched and passes non-use-cases through", async () => {
    const { cache, wrapped } = build();
    await cache.set("a", 1, { ttlMs: 60_000, tags: [userCacheTag("u1")] });
    await wrapped.listLoyaltyAccounts.execute("u1");
    expect(await cache.get("a")).toBe(1);
    expect(wrapped.notAUseCase).toBe(42);
  });
});
