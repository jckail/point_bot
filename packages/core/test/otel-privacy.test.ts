import { beforeEach, describe, expect, it, vi } from "vitest";

type Capture = { attributes: Record<string, unknown>; events: unknown[]; statuses: unknown[]; ended: number };
const capture = vi.hoisted((): Capture => ({
  attributes: {},
  events: [],
  statuses: [],
  ended: 0,
}));

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2 },
  context: { active: () => ({}) },
  metrics: {},
  trace: {
    getSpan: () => ({ spanContext: () => ({ traceId: "safe-trace", spanId: "safe-span" }) }),
    isSpanContextValid: () => true,
    getTracer: () => ({
      startActiveSpan: (_name: string, options: { attributes: object }, fn: (span: object) => unknown) => {
        Object.assign(capture.attributes, options.attributes);
        return fn({
          setAttribute: (key: string, value: unknown) => { capture.attributes[key] = value; },
          setAttributes: (values: object) => { Object.assign(capture.attributes, values); },
          recordException: (value: unknown) => { capture.events.push(value); },
          setStatus: (value: unknown) => { capture.statuses.push(value); },
          end: () => { capture.ended++; },
        });
      },
    }),
  },
}));

import { createOtelTracer } from "../src/observability/otel";
import { redact } from "../src/observability/redact";
import { createConsoleLogger } from "../src/observability/logger";

beforeEach(() => {
  capture.attributes = {};
  capture.events = [];
  capture.statuses = [];
  capture.ended = 0;
});

describe("exception privacy boundaries", () => {
  it.each([
    Object.assign(new Error("PRIVATE_PROVIDER_MESSAGE", { cause: "PRIVATE_CAUSE" }), {
      name: "PRIVATE_NAME", code: "PRIVATE_CODE", data: "PRIVATE_BODY",
    }),
    "PRIVATE_NON_ERROR",
    { message: "PRIVATE_MESSAGE", code: "PRIVATE_CODE", data: "PRIVATE_DATA" },
    Object.defineProperty(new Error("PRIVATE_GETTER"), "code", { get() { throw new Error("PRIVATE_PROPERTY"); } }),
  ])("exports fixed exception/status metadata and preserves the original rejection", async (failure) => {
    const promise = createOtelTracer().withSpan("assistant.chat", {
      "safe.count": 2, "exception.message": "PRIVATE_INITIAL", "error.code": "PRIVATE_INITIAL_CODE",
    }, async (span) => {
      span.setAttribute("exception.stacktrace", "PRIVATE_STACK");
      span.setAttribute("error.code", "PRIVATE_ATTRIBUTE_CODE");
      span.setAttributes({ "error.message": "PRIVATE_ATTRIBUTE", "safe.result": "failed" });
      throw failure;
    });
    await expect(promise).rejects.toBe(failure);
    expect(capture.events).toEqual([{ name: "OperationError", message: "Operation failed" }]);
    expect(capture.statuses).toEqual([{ code: 2, message: "Operation failed" }]);
    expect(capture.attributes).toEqual({ "safe.count": 2, "safe.result": "failed", "error.category": "operation_failed" });
    expect(capture.ended).toBe(1);
    expect(JSON.stringify(capture)).not.toContain("PRIVATE_");
  });

  it("keeps only validated public error codes without mutating the error", async () => {
    const failure = Object.assign(new Error("PRIVATE_ACCOUNT"), { code: "ASSISTANT_UNAVAILABLE", data: "PRIVATE_DATA" });
    await expect(createOtelTracer().withSpan("assistant.chat", { "error.code": "INVALID_ID" }, async (span) => {
      span.setAttribute("error.code", "INVALID_BALANCE");
      throw failure;
    })).rejects.toBe(failure);
    expect(capture.attributes["error.code"]).toBe("ASSISTANT_UNAVAILABLE");
    expect(redact(failure)).toEqual({ name: "OperationError", message: "Operation failed", category: "operation_failed", code: "ASSISTANT_UNAVAILABLE" });
    expect(failure.message).toBe("PRIVATE_ACCOUNT");
    expect(failure.data).toBe("PRIVATE_DATA");
  });

  it("preserves successful return values and ends the span without failure events", async () => {
    const result = { reply: "ok" };
    await expect(createOtelTracer().withSpan("assistant.chat", undefined, async () => result)).resolves.toBe(result);
    expect(capture.events).toEqual([]);
    expect(capture.statuses).toEqual([]);
    expect(capture.ended).toBe(1);
  });

  it("does not export private Error fields through structured log redaction", () => {
    const failure = Object.assign(new Error("PRIVATE_SQL", { cause: new Error("PRIVATE_CAUSE") }), {
      name: "PRIVATE_NAME", code: "PRIVATE_CODE", data: "PRIVATE_DATA",
    });
    const output = redact({ event: "unhandled_api_error", error: failure, token: "PRIVATE_TOKEN", tokenId: "tok_1" });
    expect(output).toEqual({ event: "unhandled_api_error", error: { name: "OperationError", message: "Operation failed", category: "operation_failed" }, token: "[REDACTED]", tokenId: "tok_1" });
    expect(JSON.stringify(output)).not.toContain("PRIVATE_");
    expect(failure.name).toBe("PRIVATE_NAME");
  });

  it.each(["PRIVATE_THROWN_STRING", { message: "PRIVATE_BODY", stack: "PRIVATE_STACK", code: "PRIVATE_CODE" }])(
    "sanitizes non-Error values in unhandled error fields", (error) => {
      expect(redact({ error })).toEqual({ error: { name: "OperationError", message: "Operation failed", category: "operation_failed" } });
    },
  );

  it("exports safe logger failures with trace correlation and timing intact", () => {
    const lines: string[] = [];
    createConsoleLogger({ write: (line) => { lines.push(line); }, now: () => new Date("2026-10-01T00:00:00Z") })
      .error("unhandled_api_error", { error: new Error("PRIVATE_PROVIDER_RESPONSE"), durationMs: 17 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("PRIVATE_");
    expect(JSON.parse(lines[0])).toEqual({
      time: "2026-10-01T00:00:00.000Z", level: "error", msg: "unhandled_api_error",
      traceId: "safe-trace", spanId: "safe-span", durationMs: 17,
      error: { name: "OperationError", message: "Operation failed", category: "operation_failed" },
    });
  });
});
