import { getObservability } from "./runtime";
import { METRIC_NAMES } from "./metrics";

/** Anything with an async `execute` (every application use case). */
export interface Executable {
  execute: (...args: never[]) => unknown;
}

function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "error";
}

/**
 * The type a traced use case really has: `execute` is always async at runtime
 * (the span wrapper awaits it), even for use cases whose class declares a
 * synchronous `execute`. Declaring that here makes a forgotten `await` a
 * `no-floating-promises` / `await-thenable` finding instead of a silent bug.
 */
export type Traced<T extends Executable> = {
  [K in keyof T]: K extends "execute"
    ? T[K] extends (...args: infer A) => infer R
      ? (...args: A) => Promise<Awaited<R>>
      : T[K]
    : T[K];
};

/** `tracedAll` result: every executable member becomes `Traced`. */
export type TracedAll<T extends object> = {
  [K in keyof T]: T[K] extends Executable ? Traced<T[K]> : T[K];
};

/**
 * Decorates a use case so each `execute` runs in a `usecase.<name>` span and
 * records `use_case_calls_total` / `use_case_duration_ms`. Arguments and
 * results are never recorded (they may hold PII). Errors pass through
 * unchanged. The observability backend is resolved per call, so wrapping at
 * composition time works even if telemetry is configured later.
 */
export function traced<T extends Executable>(
  name: string,
  useCase: T,
): Traced<T> {
  // The proxy's `execute` is the async wrapper below; the cast states that.
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
  }) as unknown as Traced<T>;
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
export function tracedAll<T extends object>(useCases: T): TracedAll<T> {
  return Object.fromEntries(
    Object.entries(useCases).map(([name, value]) => [
      name,
      isExecutable(value) ? traced(name, value) : value,
    ]),
  ) as TracedAll<T>;
}
