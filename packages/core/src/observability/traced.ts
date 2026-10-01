import { getObservability } from "./runtime";
import { METRIC_NAMES } from "./metrics";

/** Anything with an async `execute` (every application use case). */
export interface Executable {
  execute: (...args: never[]) => unknown;
}

function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "error";
}

/**
 * Decorates a use case so each `execute` runs in a `usecase.<name>` span and
 * records `use_case_calls_total` / `use_case_duration_ms`. Arguments and
 * results are never recorded (they may hold PII). Errors pass through
 * unchanged. The observability backend is resolved per call, so wrapping at
 * composition time works even if telemetry is configured later.
 */
export function traced<T extends Executable>(name: string, useCase: T): T {
  return new Proxy(useCase, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop !== "execute" || typeof value !== "function") {
        return typeof value === "function"
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      }
      return async (...args: unknown[]) => {
        const { tracer, metrics } = getObservability();
        const started = performance.now();
        let outcome = "ok";
        try {
          return await tracer.withSpan(
            `usecase.${name}`,
            { "usecase.name": name },
            async (span) => {
              try {
                const result = await (value as (...a: unknown[]) => unknown).apply(
                  target,
                  args,
                );
                span.setAttribute("usecase.outcome", "ok");
                return result;
              } catch (error) {
                outcome = "error";
                span.setAttributes({
                  "usecase.outcome": "error",
                  "error.code": codeOf(error),
                });
                throw error;
              }
            },
          );
        } catch (error) {
          outcome = "error";
          throw error;
        } finally {
          const labels = { use_case: name, outcome };
          metrics.counter(METRIC_NAMES.use_case_calls_total, labels);
          metrics.histogram(
            METRIC_NAMES.use_case_duration_ms,
            performance.now() - started,
            { use_case: name },
          );
        }
      };
    },
  });
}

function isExecutable(value: unknown): value is Executable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { execute?: unknown }).execute === "function"
  );
}

/**
 * Wraps every use case in a module record (`{ getX, createY }`) with
 * `traced`, keyed by property name. Entries without an `execute` method are
 * passed through untouched, so a whole composed module can be wrapped cheaply.
 */
export function tracedAll<T extends object>(useCases: T): T {
  return Object.fromEntries(
    Object.entries(useCases).map(([name, value]) => [
      name,
      isExecutable(value) ? traced(name, value) : value,
    ]),
  ) as T;
}
