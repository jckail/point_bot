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

/**
 * Builds a record with exactly one entry per member of a `const` tuple. The
 * single cast lives here (and is exact: the tuple is the key set) instead of
 * at every `Object.fromEntries(...) as Record<...>` call site.
 */
export function recordOf<const K extends readonly string[], V>(
  keys: K,
  make: (key: K[number]) => V,
): Record<K[number], V> {
  return Object.fromEntries(keys.map((key) => [key, make(key)])) as Record<
    K[number],
    V
  >;
}
