import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  function makeProvider() {
    const add = vi.fn(), record = vi.fn();
    const callbacks: ((result: { observe: (value: number, labels?: unknown) => void }) => void)[] = [];
    const meter = {
      createCounter: vi.fn(() => ({ add })),
      createHistogram: vi.fn(() => ({ record })),
      createObservableGauge: vi.fn(() => ({ addCallback: (callback: typeof callbacks[number]) => { callbacks.push(callback); } })),
    };
    return { getMeter: vi.fn(() => meter), meter, add, record, callbacks };
  }
  return { makeProvider, current: makeProvider() };
});
vi.mock("@opentelemetry/api", () => ({
  metrics: { getMeterProvider: () => state.current },
  SpanStatusCode: { ERROR: 2 }, context: {}, trace: {},
}));
import { createOtelMetrics } from "../src/observability/otel";

beforeEach(() => { state.current = state.makeProvider(); });

describe("OTel metrics provider registration", () => {
  it("binds counters and histograms to the current provider without replaying earlier observations", () => {
    const beforeRegistration = state.current;
    const metrics = createOtelMetrics();
    expect(beforeRegistration.getMeter).not.toHaveBeenCalled();
    metrics.counter("http_requests_total", { route: "/api/health" }, 7);
    metrics.histogram("http_request_duration_ms", 777);
    const registered = state.makeProvider(); state.current = registered;
    metrics.counter("http_requests_total", { route: "/api/health" }, 2);
    metrics.counter("http_requests_total", { route: "/api/health" }, 3);
    metrics.histogram("http_request_duration_ms", 11);
    metrics.histogram("http_request_duration_ms", 12);
    expect(registered.getMeter).toHaveBeenCalledExactlyOnceWith("pointup");
    expect(registered.meter.createCounter).toHaveBeenCalledOnce();
    expect(registered.meter.createHistogram).toHaveBeenCalledOnce();
    expect(registered.add.mock.calls).toEqual([[2, { route: "/api/health" }], [3, { route: "/api/health" }]]);
    expect(registered.record.mock.calls).toEqual([[11, undefined], [12, undefined]]);
    expect(beforeRegistration.add.mock.calls).toEqual([[7, { route: "/api/health" }]]);
    expect(beforeRegistration.record.mock.calls).toEqual([[777, undefined]]);
    const replacement = state.makeProvider(); state.current = replacement;
    metrics.counter("http_requests_total", undefined, 1);
    metrics.histogram("http_request_duration_ms", 13);
    expect(replacement.add.mock.calls).toEqual([[1, undefined]]);
    expect(replacement.record.mock.calls).toEqual([[13, undefined]]);
    expect(registered.add).toHaveBeenCalledTimes(2);
  });

  it("rebinds observable gauges with their latest values on registration and replacement", () => {
    const metrics = createOtelMetrics();
    metrics.gauge("db_ping_latency_ms", 17, { stage: "ready" });
    metrics.gauge("db_ping_latency_ms", 19, { stage: "ready" });
    const registered = state.makeProvider(); state.current = registered;
    // Any emission notices registration and rebinds existing gauge callbacks.
    metrics.counter("http_requests_total");
    expect(registered.meter.createObservableGauge).toHaveBeenCalledOnce();
    const observe = vi.fn();
    for (const callback of registered.callbacks) callback({ observe });
    expect(observe.mock.calls).toEqual([[19, { stage: "ready" }]]);
    metrics.gauge("db_ping_latency_ms", 23, { stage: "ready" });
    expect(registered.meter.createObservableGauge).toHaveBeenCalledOnce();
    observe.mockClear();
    for (const callback of registered.callbacks) callback({ observe });
    expect(observe.mock.calls).toEqual([[23, { stage: "ready" }]]);
    const replacement = state.makeProvider(); state.current = replacement;
    metrics.histogram("http_request_duration_ms", 5);
    expect(replacement.meter.createObservableGauge).toHaveBeenCalledOnce();
    observe.mockClear();
    for (const callback of replacement.callbacks) callback({ observe });
    expect(observe.mock.calls).toEqual([[23, { stage: "ready" }]]);
  });
});
