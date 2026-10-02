import { BatchTraceProcessor, OpenAITracingExporter, getGlobalTraceProvider, setTraceProcessors, type TracingProcessor } from "@openai/agents";

type SDKSpan = Parameters<TracingProcessor["onSpanEnd"]>[0];

function privateSpan(span: SDKSpan): SDKSpan {
  const copy = span.clone();
  // SDK response spans can retain provider exceptions even when sensitive span
  // data is disabled. Never derive this exported error from upstream fields.
  if (copy.error) copy.setError({ message: "Assistant operation failed", data: { category: "operation_failed" } });
  return copy;
}

/** Keep SDK IDs, timing, usage and span metadata; sanitize errors before export. */
export function privateTracingProcessor(delegate: TracingProcessor): TracingProcessor {
  return {
    start: () => delegate.start?.(),
    onTraceStart: trace => delegate.onTraceStart(trace),
    onTraceEnd: trace => delegate.onTraceEnd(trace),
    onSpanStart: span => delegate.onSpanStart(privateSpan(span)),
    onSpanEnd: span => delegate.onSpanEnd(privateSpan(span)),
    shutdown: timeout => delegate.shutdown(timeout),
    forceFlush: () => delegate.forceFlush(),
  };
}

const initializedKey = Symbol.for("pointup.assistant.privateTracing.v1");
const processState = globalThis as typeof globalThis & { [key: symbol]: WeakSet<object> | undefined };

export function isTracingKillSwitchEnabled(): boolean {
  const disabled = process.env.OPENAI_AGENTS_DISABLE_TRACING;
  return disabled === "1" || disabled === "true";
}

/** Synchronous process/HMR initialization, before the first traced live run. */
export function initializePrivateTracing(): void {
  if (isTracingKillSwitchEnabled()) return;
  const provider = getGlobalTraceProvider();
  const initialized = processState[initializedKey] ??= new WeakSet<object>();
  if (initialized.has(provider)) return;
  // Replace rather than append: an additional unsafe exporter would still leak.
  // No awaits occur before marking initialization, so concurrent requests and
  // reloaded modules cannot replace processors during another request's run.
  setTraceProcessors([privateTracingProcessor(new BatchTraceProcessor(new OpenAITracingExporter()))]);
  initialized.add(provider);
}
