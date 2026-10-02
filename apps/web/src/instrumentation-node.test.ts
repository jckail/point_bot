import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ configured: true, fail: false }));

vi.mock("@pointup/core", () => ({
  ensureObservability: vi.fn(),
  otelConfigured: () => fixture.configured,
}));
vi.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: class {
    register() {}
  },
  BatchSpanProcessor: class {},
}));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    constructor() {
      if (fixture.fail) throw new Error("https://private-user:private-password@collector.invalid/private-token");
    }
  },
}));
vi.mock("@opentelemetry/sdk-metrics", () => ({
  MeterProvider: class {},
  PeriodicExportingMetricReader: class {},
}));
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({ OTLPMetricExporter: class {} }));
vi.mock("@opentelemetry/resources", () => ({ resourceFromAttributes: vi.fn() }));
vi.mock("@opentelemetry/api", () => ({ metrics: { setGlobalMeterProvider: vi.fn() } }));

import { startTelemetry } from "./instrumentation-node";

afterEach(() => {
  fixture.configured = true;
  fixture.fail = false;
  vi.restoreAllMocks();
});

describe("optional telemetry startup", () => {
  it("keeps the server running and logs a fixed diagnostic when exporter construction fails", async () => {
    fixture.fail = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(startTelemetry()).resolves.toBeUndefined();
    expect(error.mock.calls).toEqual([["OpenTelemetry disabled: initialization failed"]]);
  });

  it("does not initialize exporters when telemetry is unconfigured", async () => {
    fixture.configured = false;
    fixture.fail = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(startTelemetry()).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });
});
