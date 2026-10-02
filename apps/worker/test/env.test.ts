import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/env";

afterEach(() => vi.unstubAllEnvs());

describe("worker optional Docker integrations", () => {
  it("treats unset Compose strings as absent integrations", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/app");
    vi.stubEnv("AUTH_PROVIDER", "dev");
    for (const key of ["CLERK_SECRET_KEY", "SLACK_WEBHOOK_URL", "DISCORD_WEBHOOK_URL", "OP_CONNECT_HOST", "OP_CONNECT_TOKEN"]) vi.stubEnv(key, "");
    const env = loadEnv();
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.SLACK_WEBHOOK_URL).toBeUndefined();
    expect(env.DISCORD_WEBHOOK_URL).toBeUndefined();
    expect(env.OP_CONNECT_HOST).toBeUndefined();
    expect(env.OP_CONNECT_TOKEN).toBeUndefined();
  });

  it("still rejects malformed nonempty integration values", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/app");
    vi.stubEnv("SLACK_WEBHOOK_URL", "invalid-webhook");
    expect(() => loadEnv()).toThrow();
  });
});
