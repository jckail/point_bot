import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter } from "../src/application/rate-limit";

describe("InMemoryRateLimiter", () => {
  const policy = { limit: 3, windowMs: 60_000 };

  function setup() {
    let t = 1_000_000;
    const limiter = new InMemoryRateLimiter(() => t);
    return { limiter, advance: (ms: number) => (t += ms) };
  }

  it("allows up to the limit then blocks with retry-after", () => {
    const { limiter, advance } = setup();
    expect(limiter.consume("a", policy)).toMatchObject({ allowed: true, remaining: 2 });
    advance(1000);
    limiter.consume("a", policy);
    limiter.consume("a", policy);
    const blocked = limiter.consume("a", policy);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfterSeconds).toBe(59);
  });

  it("recovers as old hits slide out of the window", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) limiter.consume("a", policy);
    expect(limiter.consume("a", policy).allowed).toBe(false);
    advance(60_001);
    expect(limiter.consume("a", policy).allowed).toBe(true);
  });

  it("keys are independent", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.consume("a", policy);
    expect(limiter.consume("a", policy).allowed).toBe(false);
    expect(limiter.consume("b", policy).allowed).toBe(true);
  });

  it("blocked requests do not extend the lockout", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) limiter.consume("a", policy);
    advance(30_000);
    limiter.consume("a", policy);
    expect(limiter.consume("a", policy).retryAfterSeconds).toBe(30);
  });
});
