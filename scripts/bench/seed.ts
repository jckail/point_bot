/**
 * Seeds the scratch benchmark database with synthetic users.
 *
 *   npx tsx scripts/bench/seed.ts --users=2000 [--reset]
 *
 * Per user: 5-25 accounts, 50-200 balance snapshots per account (spread over
 * ~400 days), 40 activity events, 12 outbox rows (a few pending), 1 access
 * token (plaintext `pu_bench_token_<i>`), 3 consents, 1 settings row.
 * Everything is generated set-based in SQL (generate_series), so 2,000 users
 * (~3.7M snapshots) seed in under a minute. Migrate first:
 *   DATABASE_URL=postgresql://postgres:password@localhost:5432/app_bench npm run db:migrate
 */
import postgres from "postgres";

import { PROVIDER_CATALOG } from "../../packages/core/src/domain/loyalty/provider";
import { arg, benchUrl } from "./common";

const users = Number(arg("users", "2000"));
if (!Number.isInteger(users) || users < 1 || users > 100_000) {
  throw new Error("--users must be an integer in 1..100000");
}
const reset = process.argv.includes("--reset") || process.env.BENCH_RESET === "1";

const sql = postgres(benchUrl(), { max: 1, onnotice: () => {} });
const t0 = Date.now();
const lap = (label: string) =>
  console.log(`  ${label.padEnd(22)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);

try {
  const providers = PROVIDER_CATALOG.map((p) => p.id);
  const expiring = new Set(
    PROVIDER_CATALOG.filter((p) => p.inactivityExpiryMonths !== null).map((p) => p.id),
  );
  if (providers.length < 25) throw new Error("catalog smaller than 25 providers");

  if (reset) {
    await sql`truncate loyalty_account, domain_event_outbox, access_token, consent_grant, user_setting, agent_observation cascade`;
    lap("truncated");
  }
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from loyalty_account`;
  if (n > 0) {
    console.log(`Database already holds ${n} accounts; re-run with --reset to reseed.`);
    process.exit(0);
  }

  console.log(`Seeding ${users} users into ${new URL(benchUrl()).pathname.slice(1)} ...`);
  // Deterministic per-user shape: accounts 5..25, snapshots 50..200.
  await sql`
    create temp table bench_u as
    select i,
           'bench_user_' || i as user_id,
           5 + (i * 7919) % 21 as n_accounts,
           50 + (i * 104729) % 151 as n_snaps,
           (i * 31) % ${providers.length} as p_off
    from generate_series(0, ${users - 1}) as i`;
  await sql`create temp table bench_p (idx int, id text, expires boolean)`;
  await sql`insert into bench_p select (ord - 1)::int, id, id = any(${[...expiring]}::text[])
            from unnest(${providers}::text[]) with ordinality as t(id, ord)`;
  lap("plan");

  await sql`
    insert into loyalty_account (id, user_id, provider_id, membership_number, credential_ref,
                                 expires_at, notes, pinned_at, created_at, updated_at)
    select 'acc_' || u.i || '_' || j, u.user_id, p.id, 'M' || (u.i * 1000 + j),
           case when j % 5 = 0 then 'vault://item/' || u.i || '/' || j end,
           case when p.expires then now() + ((u.i + j * 13) % 400 - 30) * interval '1 day' end,
           case when j % 4 = 0 then 'note ' || j end,
           case when j = 0 then now() end,
           now() - interval '400 days' + j * interval '1 hour', now()
    from bench_u u
    cross join lateral generate_series(0, u.n_accounts - 1) as j
    join bench_p p on p.idx = (u.p_off + j) % ${providers.length}`;
  await sql`
    insert into account_tag (account_id, tag, position)
    select a.id, t.tag, t.pos from loyalty_account a
    cross join lateral (values ('travel', 0), ('family', 1)) as t(tag, pos)
    where hashtext(a.id) % 3 = 0`;
  lap("accounts+tags");

  await sql`
    insert into balance_snapshot (id, loyalty_account_id, points, source, captured_at)
    select 'snap_' || a.id || '_' || k, a.id,
           (5000 + (hashtext(a.id || k)::bigint & 2147483647) % 400000)::bigint,
           (array['sync','manual','agent'])[1 + k % 3],
           now() - (k * (400.0 / u.n_snaps)) * interval '1 day'
    from loyalty_account a
    join bench_u u on u.user_id = a.user_id
    cross join lateral generate_series(0, u.n_snaps - 1) as k`;
  lap("balance snapshots");

  await sql`
    insert into activity_event (id, user_id, type, account_id, provider_id, summary, occurred_at)
    select 'act_' || u.i || '_' || k, u.user_id, 'balance_synced', 'acc_' || u.i || '_0',
           null, 'Synced a program: ' || (k * 137) || ' points',
           now() - k * interval '6 hours'
    from bench_u u cross join generate_series(0, 39) as k`;
  lap("activity");

  await sql`
    insert into domain_event_outbox (id, type, version, user_id, aggregate_id, payload,
                                     occurred_at, attempts, available_at, processed_at)
    select 'evt_' || u.i || '_' || k, 'balance.recorded', 1, u.user_id, 'acc_' || u.i || '_0',
           jsonb_build_object('accountId', 'acc_' || u.i || '_0', 'points', k * 100),
           now() - k * interval '1 hour', 0, now() - k * interval '1 hour',
           case when k >= 2 then now() - k * interval '59 minutes' end
    from bench_u u cross join generate_series(0, 11) as k`;
  lap("outbox");

  await sql`
    insert into access_token (id, user_id, name, display_prefix, token_hash, scopes, created_at, last_used_at)
    select 'tok_' || u.i, u.user_id, 'bench', 'pu_bench',
           encode(sha256(convert_to('pu_bench_token_' || u.i, 'UTF8')), 'hex'),
           'portfolio:read portfolio:write observations:write', now(), now()
    from bench_u u`;
  await sql`
    insert into consent_grant (id, user_id, provider_id, granted_at, expires_at)
    select 'con_' || u.i || '_' || k, u.user_id, p.id, now(), now() + interval '30 days'
    from bench_u u cross join generate_series(0, 2) as k
    join bench_p p on p.idx = (u.p_off + k) % ${providers.length}`;
  await sql`
    insert into user_setting (user_id, display_currency, updated_at)
    select user_id, 'USD', now() from bench_u`;
  lap("tokens/consents");

  await sql`analyze`;
  lap("analyze");
  const [c] = await sql`
    select (select count(*) from loyalty_account)::int as accounts,
           (select count(*) from balance_snapshot)::int as snapshots,
           (select count(*) from activity_event)::int as activity,
           (select count(*) from domain_event_outbox)::int as outbox`;
  console.log("Rows:", c);
} finally {
  await sql.end();
}
