import { isOneOf } from "../domain/shared/enum";
import { redact, redactString } from "./redact";
import { getRequestContext } from "./context";
import { activeTraceIds } from "./otel";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Readonly<Record<string, unknown>>;

/** Structured-logging port. Implementations must never throw. */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `bindings` to every line. */
  child(bindings: LogFields): Logger;
}

const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => NOOP_LOGGER,
};

export const noopLogger: Logger = NOOP_LOGGER;

export interface ConsoleLoggerOptions {
  readonly level?: LogLevel;
  /** Static fields on every line, e.g. `{ service: "web" }`. */
  readonly bindings?: LogFields;
  /** Line sink; defaults to stdout/stderr by level. Tests inject one. */
  readonly write?: (line: string, level: LogLevel) => void;
  readonly now?: () => Date;
}

export function parseLogLevel(value: string | undefined): LogLevel {
  return isOneOf(LOG_LEVELS, value) ? value : "info";
}

function defaultWrite(line: string, level: LogLevel): void {
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

/**
 * One JSON object per line, redacted. Picks up `requestId` (and trace ids,
 * when a span is active) from the ambient request context automatically.
 */
export function createConsoleLogger(options: ConsoleLoggerOptions = {}): Logger {
  const min = LOG_LEVELS.indexOf(options.level ?? "info");
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());
  const make = (bindings: LogFields): Logger => {
    const emit = (level: LogLevel, message: string, fields?: LogFields) => {
      if (LOG_LEVELS.indexOf(level) < min) return;
      try {
        const ctx = getRequestContext();
        const line = {
          time: now().toISOString(),
          level,
          msg: redactString(message),
          ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
          ...(activeTraceIds() ?? {}),
          ...(redact(bindings) as object),
          ...(fields ? (redact(fields) as object) : {}),
        };
        write(JSON.stringify(line), level);
      } catch {
        /* logging must never break a request */
      }
    };
    return {
      debug: (m, f) => emit("debug", m, f),
      info: (m, f) => emit("info", m, f),
      warn: (m, f) => emit("warn", m, f),
      error: (m, f) => emit("error", m, f),
      child: (b) => make({ ...bindings, ...b }),
    };
  };
  return make(options.bindings ?? {});
}
