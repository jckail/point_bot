import { describe, expect, it } from "vitest";

import { describeEvent } from "../src/application/events/handlers";
import {
  assertNever,
  createDomainEvent,
  EVENT_SCHEMA_VERSIONS,
  EVENT_TYPES,
  isEventOfType,
  isEventType,
  type DomainEvent,
} from "../src/domain/events";

const at = new Date("2026-07-01T00:00:00Z");

describe("domain events", () => {
  it("enumerates unique types, each with a schema version", () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
    for (const type of EVENT_TYPES) {
      expect(EVENT_SCHEMA_VERSIONS[type]).toBeGreaterThanOrEqual(1);
      expect(isEventType(type)).toBe(true);
    }
    expect(isEventType("nope")).toBe(false);
  });

  it("creates events with id, version and optional correlation id", () => {
    const event = createDomainEvent("account.linked", {
      userId: "u1",
      aggregateId: "a1",
      occurredAt: at,
      payload: { providerId: "united" },
      correlationId: "req-1",
    });
    expect(event).toMatchObject({
      type: "account.linked",
      userId: "u1",
      aggregateId: "a1",
      version: 1,
      correlationId: "req-1",
      payload: { providerId: "united" },
    });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      "correlationId" in
        createDomainEvent("token.revoked", {
          userId: "u",
          aggregateId: "t",
          occurredAt: at,
          payload: {},
        }),
    ).toBe(false);
  });

  it("narrows by type and describes every type exhaustively", () => {
    const event: DomainEvent = createDomainEvent("balance.recorded", {
      userId: "u1",
      aggregateId: "a1",
      occurredAt: at,
      payload: {
        accountId: "a1",
        providerId: "united",
        points: 10,
        previousPoints: null,
        source: "sync",
        capturedAt: at.toISOString(),
      },
    });
    expect(isEventOfType(event, "balance.recorded")).toBe(true);
    expect(isEventOfType(event, "account.linked")).toBe(false);
    expect(describeEvent(event)).toBe("Balance recorded (sync)");
  });

  it("assertNever throws on an unexpected variant", () => {
    expect(() => assertNever("x" as never)).toThrow(/Unhandled variant/);
  });
});
