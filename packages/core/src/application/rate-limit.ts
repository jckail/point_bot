/**
 * Rate limiting port + in-memory adapter.
 *
 * The in-memory limiter is PER INSTANCE: each server process keeps its own
 * counters, so with N instances the effective limit is up to N x the
 * configured one, and counters reset on restart. To enforce a global limit,
 * implement `RateLimiter` against a shared store (e.g. Redis `INCR` +
 * `PEXPIRE`, or Upstash `@upstash/ratelimit`) and swap it in where the
 * limiter is constructed (apps/web/src/server/rate-limit.ts).
 */

export interface RateLimitPolicy {
  /** Max requests allowed per window. */
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds the caller should wait before retrying (0 when allowed). */
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Records one hit for `key` and says whether it is within the policy. */
  consume(
    key: string,
    policy: RateLimitPolicy,
  ): RateLimitDecision | Promise<RateLimitDecision>;
}

/**
 * Sliding-window-log limiter. Memory is bounded by `limit` timestamps per key;
 * idle keys are pruned opportunistically.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, policy: RateLimitPolicy): RateLimitDecision {
    const now = this.now();
    this.sweep(now, policy.windowMs);
    const windowStart = now - policy.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (recent.length >= policy.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        limit: policy.limit,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + policy.windowMs - now) / 1000),
        ),
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit - recent.length,
      retryAfterSeconds: 0,
    };
  }

  private sweep(now: number, windowMs: number): void {
    if (now - this.lastSweep < windowMs) return;
    this.lastSweep = now;
    for (const [key, times] of this.hits) {
      const last = times[times.length - 1];
      if (last === undefined || last <= now - windowMs) this.hits.delete(key);
    }
  }
}
