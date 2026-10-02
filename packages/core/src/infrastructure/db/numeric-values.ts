/** Validate PostgreSQL integer text before any potentially lossy conversion. */
export function safeIntegerFromDatabase(value: unknown, minimum: number, maximum: number, invalid: () => Error): number {
  let exact: bigint;
  if (typeof value === "bigint") exact = value;
  else if (typeof value === "string" && /^-?\d+$/.test(value)) exact = BigInt(value);
  else if (typeof value === "number" && Number.isSafeInteger(value)) exact = BigInt(value);
  else throw invalid();
  if (exact < BigInt(minimum) || exact > BigInt(maximum)) throw invalid();
  return Number(exact);
}
