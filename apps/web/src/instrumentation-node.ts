import { ensureObservability, otelConfigured } from "@pointup/core";

/**
 * Node-only startup, loaded from instrumentation.ts.
 *
 * 1. Validate configuration: importing the env module validates it and trips
 *    the dev-auth production guard. A failure exits non-zero so an unsafe or
 *    misconfigured deploy refuses to run instead of failing per request.
 * 2. Telemetry: JSON logs + in-process metrics always; the OpenTelemetry SDK
 *    and OTLP/HTTP exporters are started only when OTEL_EXPORTER_OTLP_ENDPOINT
 *    is set. Without it nothing is imported or started (zero overhead).
 */
export async function validateStartup(): Promise<void> {
  try {
    await import("./env");
  } catch (error) {
    console.error(
      error instanceof Error ? `FATAL: ${error.message}` : "FATAL: invalid configuration",
    );
    process.exit(1);
  }
}

export async function startTelemetry(): Promise<void> {
  const service = process.env.OTEL_SERVICE_NAME?.trim() || "pointup-web";
  ensureObservability({ service });
  if (!otelConfigured()) return;
  try {
    const [
      { NodeTracerProvider, BatchSpanProcessor },
      { OTLPTraceExporter },
      { MeterProvider, PeriodicExportingMetricReader },
      { OTLPMetricExporter },
      { resourceFromAttributes },
      { metrics },
    ] = await Promise.all([
      import("@opentelemetry/sdk-trace-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/sdk-metrics"),
      import("@opentelemetry/exporter-metrics-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/api"),
    ]);
    const resource = resourceFromAttributes({ "service.name": service });
    new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    }).register();
    metrics.setGlobalMeterProvider(
      new MeterProvider({
        resource,
        readers: [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter(),
            exportIntervalMillis: 15_000,
          }),
        ],
      }),
    );
  } catch {
    // Telemetry must never take the app down.
    // SDK initialization errors may contain credential-bearing exporter URLs.
    console.error("OpenTelemetry disabled: initialization failed");
  }
}
