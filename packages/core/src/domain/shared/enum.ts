/**
 * Closed-set helpers. A closed set of string literals is declared once as a
 * `const` tuple, its union is derived from it, and any `Record` keyed by the
 * union uses `satisfies Record<Union, ...>`, so adding a member is a compile
 * error until every consumer handles it. See docs/architecture.md, "Type
 * system conventions".
 */

/** Compile-time exhaustiveness guard for `switch`/`if` chains over unions. */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unhandled variant: ${JSON.stringify(value)}`);
}

/** Type guard for a value drawn from a `const` tuple of string literals. */
export function isOneOf<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
