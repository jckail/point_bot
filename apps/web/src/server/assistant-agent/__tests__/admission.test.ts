import { describe, expect, it } from "vitest";
import { AssistantAdmission } from "../admission";

function admitted(limiter: AssistantAdmission, owner: string) {
  const lease = limiter.acquire(owner);
  expect(lease).toHaveProperty("release");
  if (!("release" in lease)) throw new Error("Expected admission");
  return lease;
}

describe("assistant admission", () => {
  it("limits each owner to two concurrent runs and releases exactly once", () => {
    const limiter = new AssistantAdmission(() => 0);
    const first = admitted(limiter, "owner");
    admitted(limiter, "owner");
    expect(limiter.acquire("owner")).toEqual({ retryAfter: 1 });
    first.release();
    first.release();
    admitted(limiter, "owner");
    expect(limiter.acquire("owner")).toEqual({ retryAfter: 1 });
  });
  it("limits total runs to sixteen across distinct owners", () => {
    const limiter = new AssistantAdmission(() => 0);
    const leases = Array.from({ length: 16 }, (_, i) => admitted(limiter, String(i)));
    expect(limiter.acquire("another")).toEqual({ retryAfter: 1 });
    leases[0]!.release();
    admitted(limiter, "another");
  });
  it("uses a sliding minute window and does not charge rejected requests", () => {
    let now = 0;
    const limiter = new AssistantAdmission(() => now);
    for (let i = 0; i < 10; i++) { admitted(limiter, "owner").release(); now += 1000; }
    expect(limiter.acquire("owner")).toEqual({ retryAfter: 50 });
    now = 59_999;
    expect(limiter.acquire("owner")).toEqual({ retryAfter: 1 });
    now = 60_000;
    admitted(limiter, "owner").release();
    expect(limiter.acquire("owner")).toEqual({ retryAfter: 1 });
    now = 61_000;
    admitted(limiter, "owner");
  });
  it("bounds owner storage and reclaims idle entries only when their window expires", () => {
    let now = 0;
    const limiter = new AssistantAdmission(() => now, 2);
    admitted(limiter, "first").release();
    admitted(limiter, "second").release();
    expect(limiter.acquire("third")).toEqual({ retryAfter: 60 });
    now = 60_000;
    admitted(limiter, "third");
  });
  it("retains active owners through TTL expiry so leases cannot evade concurrency limits", () => {
    let now = 0;
    const limiter = new AssistantAdmission(() => now, 1);
    const first = admitted(limiter, "owner");
    admitted(limiter, "owner");
    now = 60_000;
    expect(limiter.acquire("owner")).toEqual({ retryAfter: 1 });
    expect(limiter.acquire("other")).toEqual({ retryAfter: 60 });
    first.release();
    admitted(limiter, "owner");
  });
});
