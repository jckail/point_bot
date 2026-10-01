/** Shared helpers for the benchmark scripts (scratch database only). */
export const BENCH_DB = "app_bench";
export const DEFAULT_BENCH_URL = `postgresql://postgres:password@localhost:5432/${BENCH_DB}`;

export function benchUrl(): string {
  const url = process.env.BENCH_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_BENCH_URL;
  // Safety: the harness truncates and bulk-inserts. Never aim it at a real DB.
  if (!/bench/i.test(new URL(url).pathname)) {
    throw new Error(
      `Refusing to run against "${url}": database name must contain "bench" (default ${BENCH_DB}).`,
    );
  }
  return url;
}

/** Deterministic token plaintext for bench user `i` (seeded by seed.ts). */
export const benchToken = (i: number) => `pu_bench_token_${i}`;
export const benchUserId = (i: number) => `bench_user_${i}`;

export function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}
