/**
 * Query-level benchmark: runs the real repositories/use cases against the
 * scratch database, captures every SQL statement they emit (Drizzle logger),
 * times the call end to end, then runs EXPLAIN (ANALYZE, BUFFERS) on each
 * captured statement.
 *
 *   npx tsx scripts/bench/queries.ts [--iterations=50] [--json=out.json] [--no-explain]
 */
import { writeFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { ListActivity } from "../../packages/core/src/application/loyalty/list-activity";
import { ListExpiringAccounts } from "../../packages/core/src/application/loyalty/list-expiring-accounts";
import { ListLoyaltyAccounts } from "../../packages/core/src/application/loyalty/list-loyalty-accounts";
import { GetPortfolioSummary } from "../../packages/core/src/application/loyalty/get-portfolio-summary";
import { AuthenticateAccessToken } from "../../packages/core/src/application/agent/access-tokens";
import { hashToken } from "../../packages/core/src/domain/agent/access-token";
import * as schema from "../../packages/core/src/infrastructure/db/schema";
import { buildDrizzleRepositories } from "../../packages/core/src/composition/repositories";
import { DrizzleOutboxStore } from "../../packages/core/src/infrastructure/outbox/drizzle-outbox";
import { arg, benchToken, benchUrl, percentile } from "./common";

const iterations = Number(arg("iterations", "50"));
const explain = !process.argv.includes("--no-explain");

interface Captured { text: string; params: unknown[] }
let captured: Captured[] = [];
const client = postgres(benchUrl(), { max: 4, onnotice: () => {} });
const db = drizzle(client, {
  schema,
  logger: { logQuery: (text, params) => void captured.push({ text, params }) },
});
const repos = buildDrizzleRepositories(db as never);
const listAccounts = new ListLoyaltyAccounts(
  repos.loyaltyAccounts, repos.balanceSnapshots, undefined, repos.customValuations,
);
const outbox = new DrizzleOutboxStore(db as never);

const [heavy] = await client<{ user_id: string; i: number }[]>`
  select user_id, substr(user_id, 12)::int as i from loyalty_account
  group by user_id order by count(*) desc, user_id limit 1`;
const [median] = await client<{ user_id: string }[]>`
  select user_id from (select user_id, count(*) c from loyalty_account group by user_id) t
  order by c, user_id offset (select count(distinct user_id)/2 from loyalty_account) limit 1`;
const [{ n: heavySnaps }] = await client<{ n: number }[]>`
  select count(*)::int n from balance_snapshot s join loyalty_account a on a.id = s.loyalty_account_id
  where a.user_id = ${heavy!.user_id}`;

interface Scenario { name: string; run: () => Promise<unknown> }
const scenarios = (userId: string, tokenIdx: number): Scenario[] => [
  { name: "accounts list (accounts+tags+latest+trend+valuations)", run: () => listAccounts.execute(userId) },
  { name: "portfolio summary", run: () => new GetPortfolioSummary(listAccounts).execute(userId) },
  { name: "expiring accounts", run: () => new ListExpiringAccounts(listAccounts).execute(userId) },
  { name: "activity feed (limit 50)", run: () => new ListActivity(repos.activity).execute(userId, 50) },
  {
    name: "token authentication by hash",
    run: () => new AuthenticateAccessToken(repos.accessTokens).execute(benchToken(tokenIdx)),
  },
  { name: "consent lookup (by user)", run: () => repos.consents.findByUserId(userId) },
  {
    name: "outbox claim (poll, limit 50)",
    run: async () => {
      // Claim mutates; do it in a rolled-back transaction so data stays put.
      await db.transaction(async (tx) => {
        await new DrizzleOutboxStore(tx as never).claim({
          now: new Date(), limit: 50, leaseMs: 30_000, maxAttempts: 5,
        });
        tx.rollback();
      }).catch((e) => { if (!/rollback/i.test((e as Error).name + (e as Error).message)) throw e; });
    },
  },
];

interface Result {
  user: string; scenario: string; statements: number; p50: number; p95: number; max: number;
  plans: { sql: string; executionMs: number | null; planningMs: number | null; plan: string[] }[];
}
const results: Result[] = [];

async function measure(label: string, userId: string, tokenIdx: number) {
  for (const sc of scenarios(userId, tokenIdx)) {
    await sc.run(); // warm caches + prepared statements
    captured = [];
    await sc.run();
    const stmts = [...captured];
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t = performance.now();
      await sc.run();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const plans: Result["plans"] = [];
    if (explain) {
      for (const st of stmts) {
        if (/^\s*(begin|commit|rollback|savepoint|release)/i.test(st.text)) continue;
        try {
          const rows = await client.begin(async (tx) => {
            const r = await tx.unsafe(`explain (analyze, buffers) ${st.text}`, st.params as never[]);
            await tx`select 1`; // keep tx open until read
            throw Object.assign(new Error("rollback"), { rows: r.map((x) => String(x["QUERY PLAN"])) });
          }).catch((e) => { if ((e as Error).message === "rollback") return (e as { rows: string[] }).rows; throw e; });
          const exec = rows.find((l) => l.startsWith("Execution Time"));
          const plan = rows.find((l) => l.startsWith("Planning Time"));
          plans.push({
            sql: st.text.replace(/\s+/g, " ").slice(0, 400),
            executionMs: exec ? parseFloat(exec.split(":")[1]!) : null,
            planningMs: plan ? parseFloat(plan.split(":")[1]!) : null,
            plan: rows,
          });
        } catch (e) {
          plans.push({ sql: st.text.slice(0, 200), executionMs: null, planningMs: null, plan: [`explain failed: ${(e as Error).message}`] });
        }
      }
    }
    results.push({
      user: label, scenario: sc.name, statements: stmts.filter((s) => !/^\s*(begin|commit|rollback)/i.test(s.text)).length,
      p50: percentile(times, 50), p95: percentile(times, 95), max: times[times.length - 1]!, plans,
    });
  }
}

const idx = (u: string) => Number(u.slice("bench_user_".length));
await measure(`heavy (${heavy!.user_id}, ${heavySnaps} snapshots)`, heavy!.user_id, idx(heavy!.user_id));
await measure(`median (${median!.user_id})`, median!.user_id, idx(median!.user_id));
void hashToken;

console.log(`\nQuery-level timings (end-to-end use case, ${iterations} iterations, ms)\n`);
console.log("user".padEnd(40), "scenario".padEnd(56), "stmts", "p50".padStart(8), "p95".padStart(8));
for (const r of results) {
  console.log(r.user.slice(0, 39).padEnd(40), r.scenario.padEnd(56), String(r.statements).padStart(5),
    r.p50.toFixed(2).padStart(8), r.p95.toFixed(2).padStart(8));
}
if (explain) {
  console.log("\nEXPLAIN (ANALYZE, BUFFERS) summaries\n");
  for (const r of results) {
    for (const p of r.plans) {
      const nodes = p.plan.filter((l) => /^\s*(->)?\s*(Seq Scan|Index|Bitmap|Sort|Limit|Unique|Nested|Hash|Merge|Aggregate|Update|Result|LockRows|WindowAgg)/.test(l)).slice(0, 6);
      const buffers = p.plan.find((l) => l.includes("Buffers:")) ?? "";
      console.log(`[${r.user.split(" ")[0]}] ${r.scenario}\n  sql: ${p.sql.slice(0, 160)}\n  exec=${p.executionMs}ms plan=${p.planningMs}ms ${buffers.trim()}`);
      for (const n of nodes) console.log(`    ${n.trim().slice(0, 150)}`);
    }
  }
}
const out = arg("json", "");
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
await client.end();
