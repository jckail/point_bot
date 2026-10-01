# Running PointUp on Supabase

Supabase is used as **managed Postgres**. Drizzle stays the ORM and the single
source of schema/migrations; PointUp's server talks to Postgres directly.

## Connect

1. Create a project, copy a connection string from *Project → Connect*.
2. Pick the mode:

| Use | String | Notes |
| --- | --- | --- |
| Migrations (`npm run db:migrate`) | Direct (`db.<ref>.supabase.co:5432`) or session pooler | needs DDL + prepared statements |
| Serverless / many short-lived instances | Transaction pooler (`…pooler.supabase.com:6543`) | `createDb` auto-sets `prepare:false` |
| Long-running server (Fargate, Fly) | Direct or session pooler | |

TLS is required by Supabase; `createDb` sets `ssl: "require"` for `*.supabase.co|com`
hosts unless the URL already has `sslmode`.

```bash
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" # app
DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" npm run db:migrate  # migrate
```

## Row Level Security

Migration `0009_enable_rls.sql` enables RLS on all tables with **no policies** and
revokes `anon`/`authenticated` grants. The `postgres` role the server uses bypasses
RLS; the public REST/GraphQL API (anon key) can read and write nothing. Authorization
is enforced in the application layer (every use case scopes by `userId`).

## Auth: Clerk today, Supabase Auth later

User ids are opaque strings in every table (`user_id varchar`), so identity is
swappable. Today: Clerk sessions + PointUp personal access tokens. To move to
Supabase Auth, replace `resolvePrincipal()` in `apps/web/src/server/http.ts` and
`proxy.ts` — no domain or schema change is needed. If you later want per-user RLS
(e.g. direct client access), add policies keyed on `auth.jwt()->>'sub'` in a new
migration; it is intentionally not done now because it would split the
authorization logic across two places.

## Local

```bash
npx supabase start
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:migrate
```

(`docker compose up -d db` remains the zero-dependency alternative.)
