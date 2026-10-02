import { isErrorCode } from "../contracts";

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
/** Only measured numeric SDK usage can bypass the token secret-key filter. */
const TOKEN_COUNT_KEYS = new Set([
  "inputtokencount", "outputtokencount", "totaltokencount",
  "cachedinputtokencount", "reasoningoutputtokencount",
]);

export function redactString(value: string): string {
  return value.replace(BEARER, `Bearer ${REDACTED}`).replace(PAT, REDACTED);
}

function redactFailure(error: unknown): unknown {
  let code: unknown;
  try {
    if (typeof error === "object" && error !== null && "code" in error) code = error.code;
  } catch { /* Diagnostic getters are untrusted. */ }
  return {
    name: "OperationError",
    message: "Operation failed",
    category: "operation_failed",
    ...(isErrorCode(code) ? { code } : {}),
  };
}

/** Deep, cycle-safe redaction. Errors expose only fixed metadata and public codes. */
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
  if (value instanceof Error) return redactFailure(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (TOKEN_COUNT_KEYS.has(key.toLowerCase())) {
      out[key] = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : REDACTED;
      continue;
    }
    out[key] =
      SENSITIVE_KEY.test(key) && !ALLOWED_KEYS.has(key.toLowerCase())
        ? REDACTED
        : /^(error|exception)$/i.test(key)
          ? redactFailure(v)
          : redact(v, depth + 1, seen);
  }
  return out;
}
