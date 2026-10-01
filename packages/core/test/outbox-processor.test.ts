import { describe, expect, it } from "vitest";

import {
  createLogHandler,
  createObservationHeldNotifier,
} from "../src/application/events/handlers";
import type {
  ClaimedEvent,
  ClaimOptions,
  OutboxStore,
} from "../src/application/events/outbox";
import {
  EventHandlerRegistry,
  OutboxProcessor,
  outboxBackoffMs,
  type DeadLetterInfo,
} from "../src/application/events/outbox-processor";
import {
  createDomainEvent,
  type DomainEvent,
  type EventType,
} from "../src/domain/events";

/** Single-process fake with the same claim/lease semantics as Postgres. */
class InMemoryOutboxStore implements OutboxStore {
  readonly rows = new Map<
    string,
    {
      event: DomainEvent;
      attempts: number;
      availableAt: Date;
      processedAt: Date | null;
      deadAt: Date | null;
      lastError: string | null;
    }
  >();

  add(event: DomainEvent, availableAt = event.occurredAt) {
    this.rows.set(event.id, {
      event,
      attempts: 0,
      availableAt,
      processedAt: null,
      deadAt: null,
      lastError: null,
    });
  }

  async claim(o: ClaimOptions): Promise<ClaimedEvent[]> {
    const out: ClaimedEvent[] = [];
    for (const row of this.rows.values()) {
      if (out.length >= o.limit) break;
      if (
        row.processedAt ||
        row.deadAt ||
        row.availableAt > o.now ||
        row.attempts >= o.maxAttempts
      ) {
        continue;
      }
      row.attempts += 1;
      row.availableAt = new Date(o.now.getTime() + o.leaseMs);
      out.push({ event: row.event, attempts: row.attempts });
    }
    return out;
  }
  async markProcessed(id: string, now: Date) {
    this.rows.get(id)!.processedAt ??= now;
  }
  async scheduleRetry(id: string, retryAt: Date, error: string) {
    const row = this.rows.get(id)!;
    row.availableAt = retryAt;
    row.lastError = error;
  }
  async deadLetter(id: string, now: Date, error: string) {
    const row = this.rows.get(id)!;
    row.deadAt = now;
    row.lastError = error;
  }
  async deadLetterExhausted(max: number, now: Date) {
    let n = 0;
    for (const row of this.rows.values()) {
      if (!row.processedAt && !row.deadAt && row.attempts >= max && row.availableAt <= now) {
        row.deadAt = now;
        n += 1;
      }
    }
    return n;
  }
}

let t = new Date("2026-07-01T12:00:00Z");
const clock = { now: () => t };

function event(type: EventType = "account.linked", id?: string): DomainEvent {
  return createDomainEvent("account.linked", {
    id,
    userId: "u1",
    aggregateId: "a1",
    occurredAt: new Date("2026-07-01T11:00:00Z"),
    payload: { providerId: "united" },
  }) as DomainEvent & { type: typeof type };
}

describe("OutboxProcessor", () => {
  it("dispatches to type and wildcard handlers, then marks processed", async () => {
    t = new Date("2026-07-01T12:00:00Z");
    const store = new InMemoryOutboxStore();
    const e = event();
    store.add(e);
    const seen: string[] = [];
    const registry = new EventHandlerRegistry()
      .on("*", { name: "all", handle: async (ev) => void seen.push(`all:${ev.type}`) })
      .on("account.linked", { name: "one", handle: async (ev) => void seen.push(`one:${ev.id}`) })
      .on("goal.created", { name: "other", handle: async () => void seen.push("other") });
    const result = await new OutboxProcessor(store, registry, { clock }).runOnce();
    expect(result).toEqual({ claimed: 1, processed: 1, retried: 0, deadLettered: 0 });
    expect(seen).toEqual(["all:account.linked", `one:${e.id}`]);
    expect(store.rows.get(e.id)!.processedAt).toEqual(t);
    // Nothing left to do.
    expect((await new OutboxProcessor(store, registry, { clock }).runOnce()).claimed).toBe(0);
  });

  it("marks events without handlers as processed", async () => {
    const store = new InMemoryOutboxStore();
    store.add(event());
    const r = await new OutboxProcessor(store, new EventHandlerRegistry(), { clock }).runOnce();
    expect(r.processed).toBe(1);
  });

  it("retries with exponential backoff, then dead-letters and fires the hook", async () => {
    t = new Date("2026-07-01T12:00:00Z");
    const store = new InMemoryOutboxStore();
    const e = event();
    store.add(e);
    let calls = 0;
    const registry = new EventHandlerRegistry().on("account.linked", {
      name: "flaky",
      handle: async () => {
        calls += 1;
        throw new Error("boom");
      },
    });
    const dead: DeadLetterInfo[] = [];
    const processor = new OutboxProcessor(store, registry, {
      clock,
      maxAttempts: 3,
      baseBackoffMs: 1000,
      onDeadLetter: (info) => dead.push(info),
    });

    expect(await processor.runOnce()).toMatchObject({ retried: 1 });
    const row = store.rows.get(e.id)!;
    expect(row.lastError).toBe("flaky: boom");
    expect(row.availableAt.getTime() - t.getTime()).toBe(1000);

    // Not claimable before the backoff elapses.
    expect((await processor.runOnce()).claimed).toBe(0);

    t = new Date(t.getTime() + 1000);
    await processor.runOnce();
    expect(row.availableAt.getTime() - t.getTime()).toBe(2000);

    t = new Date(t.getTime() + 2000);
    expect(await processor.runOnce()).toMatchObject({ deadLettered: 1 });
    expect(row.deadAt).not.toBeNull();
    expect(row.attempts).toBe(3);
    expect(calls).toBe(3);
    expect(dead).toEqual([{ event: e, attempts: 3, error: "flaky: boom" }]);

    t = new Date(t.getTime() + 10 * 3_600_000);
    expect((await processor.runOnce()).claimed).toBe(0);
  });

  it("recovers a recorded retry once the handler succeeds", async () => {
    t = new Date("2026-07-01T12:00:00Z");
    const store = new InMemoryOutboxStore();
    const e = event();
    store.add(e);
    let fail = true;
    const registry = new EventHandlerRegistry().on("*", {
      name: "h",
      handle: async () => {
        if (fail) throw new Error("down");
      },
    });
    const processor = new OutboxProcessor(store, registry, { clock, baseBackoffMs: 100 });
    await processor.runOnce();
    fail = false;
    t = new Date(t.getTime() + 100);
    expect(await processor.runOnce()).toMatchObject({ processed: 1 });
  });

  it("dead-letters rows whose last attempt crashed without an outcome", async () => {
    t = new Date("2026-07-01T12:00:00Z");
    const store = new InMemoryOutboxStore();
    const e = event();
    store.add(e);
    const row = store.rows.get(e.id)!;
    row.attempts = 3; // claimed on the final attempt, worker died
    row.availableAt = new Date(t.getTime() - 1);
    const r = await new OutboxProcessor(store, new EventHandlerRegistry(), {
      clock,
      maxAttempts: 3,
    }).runOnce();
    expect(r.deadLettered).toBe(1);
    expect(row.deadAt).not.toBeNull();
  });

  it("caps backoff", () => {
    expect(outboxBackoffMs(1)).toBe(5000);
    expect(outboxBackoffMs(3)).toBe(20_000);
    expect(outboxBackoffMs(50)).toBe(3_600_000);
  });
});

describe("handlers", () => {
  it("log handler emits one JSON line with ids only (no payload)", async () => {
    const lines: string[] = [];
    const e = createDomainEvent("balance.recorded", {
      userId: "u1",
      aggregateId: "a1",
      occurredAt: new Date("2026-07-01T00:00:00Z"),
      correlationId: "req-9",
      payload: {
        accountId: "a1",
        providerId: "united",
        points: 12345,
        previousPoints: null,
        source: "manual",
        capturedAt: "2026-07-01T00:00:00.000Z",
      },
    });
    await createLogHandler((l) => lines.push(l)).handle(e);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({
      msg: "domain_event",
      type: "balance.recorded",
      eventId: e.id,
      userId: "u1",
      aggregateId: "a1",
      correlationId: "req-9",
    });
    expect(lines[0]).not.toContain("12345");
  });

  it("notifier handler only reacts to observation.held", async () => {
    const sent: string[] = [];
    const handler = createObservationHeldNotifier({
      notify: async (n) => void sent.push(n.text),
    });
    await handler.handle(event());
    expect(sent).toEqual([]);
    await handler.handle(
      createDomainEvent("observation.held", {
        userId: "u1",
        aggregateId: "o1",
        occurredAt: new Date(),
        payload: {
          accountId: "a1",
          providerId: "united",
          points: 900000,
          previousPoints: 1000,
          reviewExpiresAt: new Date().toISOString(),
        },
      }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("held for review");
    expect(sent[0]).not.toContain("u1");
  });
});
