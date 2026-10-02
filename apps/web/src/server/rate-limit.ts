import { InMemoryRateLimiter, type RateLimiter } from "@pointup/core";

/**
 * Process-wide limiter. In-memory => per instance (see
 * packages/core/src/application/rate-limit.ts). To share limits across
 * instances, return a Redis/Upstash-backed `RateLimiter` here instead.
 */
const globalForLimiter = globalThis as unknown as {
  __pointupRateLimiter?: RateLimiter;
};

export function getRateLimiter(): RateLimiter {
  globalForLimiter.__pointupRateLimiter ??= new InMemoryRateLimiter();
  return globalForLimiter.__pointupRateLimiter;
}
