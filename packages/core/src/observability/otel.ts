import {
  SpanStatusCode,
  context,
  metrics as otelMetrics,
  trace,
  type Attributes,
} from "@opentelemetry/api";

import { METRIC_DEFS, type MetricLabels, type MetricName, type Metrics } from "./metrics";
import type { SpanAttributes, SpanHandle, Tracer } from "./tracer";
import { isErrorCode } from "../contracts";

/**
 * OpenTelemetry adapters. Only the tiny `@opentelemetry/api` package is used
 * here: without an SDK registered by the host app these are no-ops inside the
 * API package itself, so there is no vendor lock-in and no overhead. The
 * SDK/exporters are wired in the apps (see docs/observability.md).
 */

const SCOPE = "pointup";

function clean(attributes: SpanAttributes | undefined): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attributes ?? {})) {
    // Exception attributes can contain provider payloads, SQL or portfolio data.
    // Only the closed public error-code catalog is safe to retain.
    if (k.startsWith("error.") || k.startsWith("exception.")) {
      if (k === "error.code" && isErrorCode(v)) out[k] = v;
      continue;
    }
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function createOtelTracer(): Tracer {
  const tracer = trace.getTracer(SCOPE);
  return {
    withSpan(name, attributes, fn) {
      return tracer.startActiveSpan(
        name,
        { attributes: clean(attributes) },
        async (span) => {
          const handle: SpanHandle = {
            setAttribute: (k, v) => void span.setAttributes(clean({ [k]: v })),
            setAttributes: (a) => void span.setAttributes(clean(a)),
          };
          try {
            return await fn(handle);
          } catch (error) {
            span.recordException({ name: "OperationError", message: "Operation failed" });
            span.setAttribute("error.category", "operation_failed");
            // Untrusted exception properties may themselves be throwing getters.
            // Observability must preserve the original rejection in that case.
            try {
              if (typeof error === "object" && error !== null && "code" in error) {
                const code = error.code;
                if (isErrorCode(code)) span.setAttribute("error.code", code);
              }
            } catch { /* Ignore untrusted diagnostic properties. */ }
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Operation failed",
            });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    },
  };
}

/** Trace/span ids of the active span, for log correlation. */
export function activeTraceIds(): { traceId: string; spanId: string } | undefined {
  const ctx = trace.getSpan(context.active())?.spanContext();
  return ctx && trace.isSpanContextValid(ctx)
    ? { traceId: ctx.traceId, spanId: ctx.spanId }
    : undefined;
}

export function createOtelMetrics(): Metrics {
  const meter = otelMetrics.getMeter(SCOPE);
  const counters = new Map<MetricName, ReturnType<typeof meter.createCounter>>();
  const histograms = new Map<MetricName, ReturnType<typeof meter.createHistogram>>();
  const gaugeValues = new Map<MetricName, Map<string, { v: number; labels: MetricLabels | undefined }>>();

  return {
    counter(name, labels, value = 1) {
      let c = counters.get(name);
      if (!c) {
        c = meter.createCounter(name, { description: METRIC_DEFS[name].help });
        counters.set(name, c);
      }
      c.add(value, labels);
    },
    histogram(name, value, labels) {
      let h = histograms.get(name);
      if (!h) {
        h = meter.createHistogram(name, { description: METRIC_DEFS[name].help });
        histograms.set(name, h);
      }
      h.record(value, labels);
    },
    gauge(name, value, labels) {
      let values = gaugeValues.get(name);
      if (!values) {
        const store = (values = new Map());
        gaugeValues.set(name, store);
        meter
          .createObservableGauge(name, { description: METRIC_DEFS[name].help })
          .addCallback((result) => {
            for (const { v, labels: l } of store.values())
              result.observe(v, l as Attributes | undefined);
          });
      }
      values.set(JSON.stringify(labels ?? {}), { v: value, labels });
    },
  };
}
