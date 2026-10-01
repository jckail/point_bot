/**
 * Worker fan-out benchmark for SyncAllLoyaltyAccounts.
 *
 *   npx tsx scripts/bench/sync-fanout.ts [--users=20] [--latency=40] [--pool=10]
 *
 * Runs the real use case (real Drizzle repositories, transactional outbox) on
 * the scratch database with a simulated provider gateway that sleeps
 * `--latency` ms (+-25% jitter) per fetch, for several (accounts-per-user x
 * users-in-flight) settings. It appends snapshots/activity/outbox rows to the
 * scratch DB. `--latency=0` shows the database-bound ceiling.
 */
import postgres from "postgres";

import { SyncAllLoyaltyAccounts } from "../../packages/core/src/application/loyalty/sync-all-loyalty-accounts";
import { SyncLoyaltyAccount } from "../../packages/core/src/application/loyalty/sync-loyalty-account";
import type { TravelProviderGateway } from "../../packages/core/src/application/ports";
import { buildDrizzleRepositories } from "../../packages/core/src/composition/repositories";
import { createDb } from "../../packages/core/src/infrastructure/db/client";
import { arg, benchUrl } from "./common";

const users = Number(arg("users", "20"));
const latency = Number(arg("latency", "40"));
const pool = Number(arg("pool", "10"));

const db = createDb(benchUrl(), { max: pool });
const repos = buildDrizzleRepositories(db);
const gateway: TravelProviderGateway = {
  supports: () => true,
  fetchBalance: async () => {
    if (latency > 0) await new Promise((r) => setTimeout(r, latency * (0.75 + Math.random() * 0.5)));
    return { points: Math.floor(Math.random() * 100_000) };
  },
};
const vault = { resolve: async () => ({ username: "bench", secret: "bench" }) };
const syncOne = new SyncLoyaltyAccount(
  repos.loyaltyAccounts, repos.balanceSnapshots, gateway, vault, repos.activity, undefined, repos.eventing,
);

const userIds = (await repos.loyaltyAccounts.listUserIds()).sort().slice(0, users);

async function run(perUser: number, lanes: number) {
  const useCase = new SyncAllLoyaltyAccounts(repos.loyaltyAccounts, syncOne, perUser);
  let next = 0;
  let syncs = 0;
  const start = performance.now();
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (let i = next++; i < userIds.length; i = next++) {
        syncs += (await useCase.execute(userIds[i]!)).filter((o) => o.ok).length;
      }
    }),
  );
  const secs = (performance.now() - start) / 1000;
  return { syncs, secs, rate: syncs / secs };
}

console.log(`${userIds.length} users, gateway latency ${latency}ms, DB pool ${pool}\n`);
console.log("| per-user concurrency | users in flight | in flight | syncs | wall s | syncs/s | speedup |");
console.log("|---:|---:|---:|---:|---:|---:|---:|");
let base = 0;
for (const [perUser, lanes] of [[1, 1], [2, 1], [4, 1], [8, 1], [4, 2], [4, 4], [8, 4]] as const) {
  const r = await run(perUser, lanes);
  base ||= r.rate;
  console.log(`| ${perUser} | ${lanes} | ${perUser * lanes} | ${r.syncs} | ${r.secs.toFixed(1)} | ${r.rate.toFixed(0)} | ${(r.rate / base).toFixed(1)}x |`);
}
await (db as unknown as { $client: postgres.Sql }).$client.end();
