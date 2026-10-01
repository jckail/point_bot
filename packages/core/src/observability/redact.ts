/**
 * Log redaction. Applied to every structured log line before it is written,
 * so a token or password can never reach stdout by accident.
 */

export const REDACTED = "[REDACTED]";

/** Key names (case-insensitive, substring) whose values are always redacted. */
const SENSITIVE_KEY = /authorization|token|secret|password|passwd|cookie|api[-_]?key|credential|signature/i;
/** PointUp personal access tokens, anywhere inside a string. */
const PAT = /pu_[A-Za-z0-9_-]{20,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

const MAX_DEPTH = 8;

/** Keys that look sensitive but are safe identifiers (never secret values). */
const ALLOWED_KEYS = new Set(["tokenid", "token_id", "tokenkind", "principalkind"]);

export function redactString(value: string): string {
  return value.replace(BEARER, `Bearer ${REDACTED}`).replace(PAT, REDACTED);
}

function redactError(error: Error, depth: number, seen: WeakSet<object>): unknown {
  return {
    name: error.name,
    message: redactString(error.message),
    ...(error.stack ? { stack: redactString(error.stack) } : {}),
    ...(error.cause !== undefined
      ? { cause: redact(error.cause, depth + 1, seen) }
      : {}),
  };
}

/** Deep, cycle-safe redaction. Errors become `{name,message,stack,cause}`. */
export function redact(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Error) return redactError(value, depth, seen);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] =
      SENSITIVE_KEY.test(key) && !ALLOWED_KEYS.has(key.toLowerCase())
        ? REDACTED
        : redact(v, depth + 1, seen);
  }
  return out;
}
