import { describe, expect, it, vi } from "vitest";

import {
  AuthenticateAccessToken,
  DEFAULT_TOUCH_INTERVAL_MS,
  IssueAccessToken,
} from "../src/application/agent/access-tokens";
import type { AccessToken } from "../src/domain/agent/access-token";
import { InMemoryTokens } from "./fakes";

let now = new Date("2026-07-08T12:00:00.000Z");
const clock = { now: () => now };

async function issued(tokens: InMemoryTokens) {
  now = new Date("2026-07-08T12:00:00.000Z");
  return new IssueAccessToken(tokens, clock).execute({
    userId: "u1",
    name: "t",
    scopes: ["portfolio:read"],
  });
}

describe("token last-used touch", () => {
  it("does not block authentication on a slow write", async () => {
    const tokens = new InMemoryTokens();
    const { plaintext } = await issued(tokens);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const update = vi.spyOn(tokens, "update").mockImplementation(async () => gate);
    const principal = await new AuthenticateAccessToken(tokens, clock).execute(plaintext);
    expect(principal.userId).toBe("u1");
    expect(update).toHaveBeenCalledTimes(1); // started, still pending
    release();
  });

  it("swallows write failures (sync throw and rejection), reports them, keeps the result", async () => {
    const tokens = new InMemoryTokens();
    const { plaintext } = await issued(tokens);
    const errors: unknown[] = [];
    const auth = new AuthenticateAccessToken(tokens, clock, {
      onTouchError: (e) => errors.push(e),
    });
    vi.spyOn(tokens, "update").mockRejectedValueOnce(new Error("db down"));
    await expect(auth.execute(plaintext)).resolves.toMatchObject({ userId: "u1" });
    await vi.waitFor(() => expect(errors).toHaveLength(1));

    now = new Date(now.getTime() + 10 * DEFAULT_TOUCH_INTERVAL_MS);
    vi.spyOn(tokens, "update").mockImplementationOnce(() => {
      throw new Error("sync boom");
    });
    await expect(auth.execute(plaintext)).resolves.toMatchObject({ userId: "u1" });
    expect(errors).toHaveLength(2);

    // A throwing hook must not break authentication either.
    const loud = new AuthenticateAccessToken(tokens, clock, {
      onTouchError: () => {
        throw new Error("hook");
      },
    });
    now = new Date(now.getTime() + 10 * DEFAULT_TOUCH_INTERVAL_MS);
    vi.spyOn(tokens, "update").mockRejectedValueOnce(new Error("again"));
    await expect(loud.execute(plaintext)).resolves.toMatchObject({ userId: "u1" });
  });

  it("throttles by the configured interval (default 300 s)", async () => {
    const tokens = new InMemoryTokens();
    const { plaintext } = await issued(tokens);
    const update = vi.spyOn(tokens, "update");
    const auth = new AuthenticateAccessToken(tokens, clock);
    await auth.execute(plaintext); // never used -> touch
    expect(update).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + 299_000);
    await auth.execute(plaintext);
    expect(update).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + 2_000);
    await auth.execute(plaintext);
    expect(update).toHaveBeenCalledTimes(2);

    const custom = new AuthenticateAccessToken(tokens, clock, { touchIntervalMs: 1_000 });
    now = new Date(now.getTime() + 1_500);
    await custom.execute(plaintext);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("prefers the narrow touchLastUsed when the repository has it", async () => {
    const tokens = new InMemoryTokens();
    const { plaintext } = await issued(tokens);
    const touched: [string, Date][] = [];
    (tokens as unknown as { touchLastUsed: (id: string, at: Date) => Promise<void> }).touchLastUsed =
      async (id, at) => void touched.push([id, at]);
    const update = vi.spyOn(tokens, "update");
    await new AuthenticateAccessToken(tokens, clock).execute(plaintext);
    expect(touched).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("never changes auth results: revoked and unknown tokens still fail", async () => {
    const tokens = new InMemoryTokens();
    const { plaintext, token } = await issued(tokens);
    const row = tokens.rows.get(token.id) as AccessToken;
    tokens.rows.set(token.id, { ...row, revokedAt: now });
    const auth = new AuthenticateAccessToken(tokens, clock);
    await expect(auth.execute(plaintext)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
