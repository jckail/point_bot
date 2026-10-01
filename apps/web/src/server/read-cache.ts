import { InMemoryCache, userCacheTag, type Cache } from "@pointup/core";

/**
 * Read-model cache for the web process.
 *
 * What is cached: each user's accounts read model (`ListLoyaltyAccounts`),
 * which the summary, expiring, advice, digest and dashboard all derive from.
 * That collapses the dashboard's 3-4 identical reads per render into one and
 * turns repeated API polling into a map lookup.
 *
 * Consistency:
 * - Read-your-writes within this process: every non-read use case invalidates
 *   the caller's `user:<id>` tag when it finishes (see `invalidateOnWrite`),
 *   and loads that were in flight during the write are never stored.
 * - Writes made elsewhere (worker syncs, other web instances) become visible
 *   after at most `READ_CACHE_TTL_MS` (default 10s; `0` disables the cache).
 */

const DEFAULT_TTL_MS = 10_000;

export function readCacheTtlMs(): number {
  const raw = process.env.READ_CACHE_TTL_MS;
  if (raw === undefined || raw === "") return DEFAULT_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TTL_MS;
}

const globalForCache = globalThis as unknown as { __pointupReadCache?: Cache };

/** Process-wide cache (survives HMR reloads in development). */
export function getReadCache(): Cache {
  globalForCache.__pointupReadCache ??= new InMemoryCache({ maxEntries: 5_000 });
  return globalForCache.__pointupReadCache;
}

/** Use cases that never change cached data. Everything else invalidates. */
const READ_ONLY_USE_CASE = /^(list|get|build|plan|authenticate|chat|ingest)/;

function userIdOf(args: readonly unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === "string") return first;
  if (typeof first === "object" && first !== null) {
    const userId = (first as { userId?: unknown }).userId;
    if (typeof userId === "string") return userId;
  }
  return undefined;
}

function isExecutable(value: unknown): value is { execute: (...a: never[]) => unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { execute?: unknown }).execute === "function"
  );
}

/**
 * Wraps every mutating use case so the user's cached read models are dropped
 * once it settles (also on failure: a partially applied write must not leave
 * stale data behind). Default-deny: a use case is treated as a write unless
 * its name says it only reads, so new use cases are safe without touching
 * this file.
 */
export function invalidateOnWrite<T extends object>(useCases: T, cache: Cache): T {
  return Object.fromEntries(
    Object.entries(useCases).map(([name, value]) => {
      if (!isExecutable(value) || READ_ONLY_USE_CASE.test(name)) return [name, value];
      return [
        name,
        new Proxy(value, {
          get(target, prop) {
            const member = Reflect.get(target, prop, target) as unknown;
            if (typeof member !== "function") return member;
            if (prop !== "execute") return member.bind(target);
            return async (...args: unknown[]) => {
              try {
                return await (member as (...a: unknown[]) => unknown).apply(target, args);
              } finally {
                const userId = userIdOf(args);
                if (userId) await cache.invalidateTag(userCacheTag(userId));
              }
            };
          },
        }),
      ];
    }),
  ) as T;
}
