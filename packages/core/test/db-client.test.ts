import { describe, expect, it } from "vitest";

import { postgresOptionsFor } from "../src/infrastructure/db/client";

describe("postgresOptionsFor", () => {
  it("leaves local Postgres untouched", () => {
    expect(postgresOptionsFor("postgresql://postgres:pw@localhost:5432/app")).toEqual({});
  });

  it("requires TLS for hosted Supabase and disables prepared statements on the transaction pooler", () => {
    expect(
      postgresOptionsFor(
        "postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      ),
    ).toEqual({ ssl: "require", prepare: false });
  });

  it("disables prepared statements behind a local PgBouncer (port 6432)", () => {
    expect(
      postgresOptionsFor("postgresql://postgres:password@pgbouncer:6432/app"),
    ).toEqual({ prepare: false });
  });

  it("keeps prepared statements on the session pooler / direct connection", () => {
    expect(
      postgresOptionsFor("postgresql://postgres:pw@db.abc.supabase.co:5432/postgres"),
    ).toEqual({ ssl: "require" });
  });

  it("respects an explicit sslmode and tolerates garbage input", () => {
    expect(
      postgresOptionsFor("postgresql://u:p@db.abc.supabase.co:5432/postgres?sslmode=disable"),
    ).toEqual({});
    expect(postgresOptionsFor("not a url")).toEqual({});
  });
});
