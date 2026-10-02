import { createConsoleLogger, noopLogger, parseLogLevel, type Logger } from "./logger";
import {
  PrometheusMetrics,
  combineMetrics,
  noopMetrics,
  type Metrics,
} from "./metrics";
import { createOtelMetrics, createOtelTracer } from "./otel";
import { noopTracer, type SpanAttributes, type SpanCallback, type Tracer } from "./tracer";

export interface Observability {
  readonly logger: Logger;
  readonly tracer: Tracer;
  readonly metrics: Metrics;
  /** Present when the in-process Prometheus registry is active. */
  readonly prometheus?: PrometheusMetrics;
}

const NOOP: Observability = {
  logger: noopLogger,
  tracer: noopTracer,
  metrics: noopMetrics,
};

/**
 * Process-wide singleton on globalThis: Next.js bundles route handlers,
 * instrumentation and server code separately, and HMR re-evaluates modules.
 * Defaults to no-ops until a host calls `configureObservability`.
 */
const KEY = Symbol.for("pointup.observability");
type Holder = { [KEY]?: Observability };

export function getObservability(): Observability {
  return (globalThis as Holder)[KEY] ?? NOOP;
}

export function configureObservability(value: Observability): Observability {
  (globalThis as Holder)[KEY] = value;
  return value;
}

/** For tests. */
export function resetObservability(): void {
  delete (globalThis as Holder)[KEY];
}

export interface CreateObservabilityOptions {
  readonly service: string;
  readonly env?: Record<string, string | undefined>;
  /** Override the log sink (tests). */
  readonly write?: (line: string) => void;
}

/** True when an OTLP endpoint is configured (traces or generic). */
export function otelConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !!(
    env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
  );
}

/**
 * Default wiring: JSON console logs, in-process Prometheus metrics, and OTel
 * tracing/metrics adapters only when an OTLP endpoint is configured (the host
 * app registers the SDK; without it these adapters are API-level no-ops).
 */
export function createObservability(
  options: CreateObservabilityOptions,
): Observability {
  const env = options.env ?? process.env;
  const otel = otelConfigured(env);
  const prometheus = new PrometheusMetrics();
  return {
    logger: createConsoleLogger({
      level: parseLogLevel(env.LOG_LEVEL),
      bindings: { service: options.service },
      ...(options.write ? { write: options.write } : {}),
    }),
    tracer: otel ? createOtelTracer() : noopTracer,
    metrics: otel ? combineMetrics(prometheus, createOtelMetrics()) : prometheus,
    prometheus,
  };
}

/** Idempotent: configures once per process and returns the instance. */
export function ensureObservability(
  options: CreateObservabilityOptions,
): Observability {
  const existing = (globalThis as Holder)[KEY];
  return existing ?? configureObservability(createObservability(options));
}

/** Runs `fn` in a span using the configured tracer. */
export function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: SpanCallback<T>,
): Promise<T> {
  return getObservability().tracer.withSpan(name, attributes, fn);
}
