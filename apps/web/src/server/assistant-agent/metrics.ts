import type { Metrics, MetricName } from "@pointup/core/observability";
import type { Observation } from "./observation";

const outcomes = new Set(["success", "failed", "timeout", "cancelled", "max_turns", "partial"]);

/** Aggregate operational metrics; SDK trace, request, user and tool IDs stay in logs. */
export function recordAssistantMetrics(metrics: Metrics | undefined, event: Observation): void {
  if (!metrics) return;
  const labels = {
    source: event.surface === "web" || event.surface === "extension" ? event.surface : "api",
    mode: event.mode === "agents" ? "agents" : "fallback",
    outcome: event.event === "run_started" ? "started" : outcomes.has(event.status ?? "") ? event.status! : "unknown",
  };
  const count = (name: MetricName, value: number | undefined) => {
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) return;
    try { metrics.counter(name, labels, value); } catch { /* telemetry is best effort */ }
  };
  const duration = (name: MetricName) => {
    if (event.durationMs === undefined || !Number.isFinite(event.durationMs) || event.durationMs < 0) return;
    try { metrics.histogram(name, event.durationMs, labels); } catch { /* telemetry is best effort */ }
  };
  switch (event.event) {
    case "run_started":
    case "run_completed":
    case "run_failed":
      count("assistant_run_events_total", 1);
      if (event.event === "run_completed") duration("assistant_run_duration_ms");
      break;
    case "tool_completed":
      count("assistant_tool_calls_total", 1);
      duration("assistant_tool_duration_ms");
      break;
    case "run_usage":
      count("assistant_model_requests_total", event.modelRequests);
      count("assistant_input_tokens_total", event.inputTokens);
      count("assistant_output_tokens_total", event.outputTokens);
      count("assistant_total_tokens_total", event.totalTokens);
      count("assistant_cached_input_tokens_total", event.cachedInputTokens);
      count("assistant_reasoning_output_tokens_total", event.reasoningOutputTokens);
      break;
  }
}
