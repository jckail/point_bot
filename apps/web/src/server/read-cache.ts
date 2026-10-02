import { createHash } from "node:crypto";

import { type Cache, InMemoryCache, userCacheTag, UserId } from "@pointup/core";

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

function userIdOf(args: readonly unknown[]): UserId | undefined {
  const first = args[0];
  if (UserId.is(first)) return first;
  if (typeof first === "object" && first !== null) {
    const userId = (first as { userId?: unknown }).userId;
    if (UserId.is(userId)) return userId;
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

/** Opt-in token-authentication cache TTL (`AUTH_CACHE_TTL_MS`, default 0 = off). */
export function authCacheTtlMs(): number {
  const parsed = Number(process.env.AUTH_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Minimum gap between `access_token.last_used_at` writes
 * (`AUTH_TOUCH_INTERVAL_SECONDS`, default 300). The write is fire-and-forget.
 */
export function authTouchIntervalMs(): number {
  const raw = process.env.AUTH_TOUCH_INTERVAL_SECONDS;
  const parsed = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1000 : 300_000;
}

interface Authenticator {
  execute: (plaintext: string) => Promise<{ userId: UserId }>;
}

/**
 * Remembers successful bearer-token authentications for `ttlMs`, skipping the
 * token lookup (and its occasional `last_used_at` write) on the hot path.
 *
 * Trade-off, which is why it is opt-in: a token revoked through this process
 * stops working immediately (revoking is a write use case, so it drops the
 * user's entries), but a revocation made on another instance is honoured only
 * after the TTL. Failures are never cached. Entries are keyed by the SHA-256
 * of the token, so plaintext tokens are not retained in memory.
 */
export function cacheAuthentication<T extends { authenticateAccessToken: Authenticator }>(
  useCases: T,
  cache: Cache,
  ttlMs: number,
): T {
  if (ttlMs <= 0) return useCases;
  const inner = useCases.authenticateAccessToken;
  const wrapped: Authenticator = {
    execute: async (plaintext) => {
      const key = `auth:${createHash("sha256").update(plaintext).digest("hex")}`;
      const hit = await cache.get<{ userId: UserId }>(key);
      if (hit) return hit;
      const principal = await inner.execute(plaintext);
      await cache.set(key, principal, { ttlMs, tags: [userCacheTag(principal.userId)] });
      return principal;
    },
  };
  return { ...useCases, authenticateAccessToken: wrapped };
}
