import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  parseSlackCommand,
  resolveUserId,
  verifySlackSignature,
} from "../src/slack";

const SECRET = "shhh";

function sign(rawBody: string, timestamp: string): string {
  return (
    "v0=" +
    createHmac("sha256", SECRET).update(`v0:${timestamp}:${rawBody}`).digest("hex")
  );
}

describe("verifySlackSignature", () => {
  const rawBody = "command=%2Fpointbot&text=portfolio&user_id=U123";
  const nowMs = 1_760_000_000_000;
  const timestamp = String(Math.floor(nowMs / 1000));

  it("accepts a correctly signed, fresh request", () => {
    expect(
      verifySlackSignature({
        rawBody,
        signature: sign(rawBody, timestamp),
        timestamp,
        signingSecret: SECRET,
        nowMs,
      }),
    ).toBe(true);
  });

  it("rejects a bad signature", () => {
    expect(
      verifySlackSignature({
        rawBody,
        signature: "v0=deadbeef",
        timestamp,
        signingSecret: SECRET,
        nowMs,
      }),
    ).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const staleTs = String(Math.floor(nowMs / 1000) - 600);
    expect(
      verifySlackSignature({
        rawBody,
        signature: sign(rawBody, staleTs),
        timestamp: staleTs,
        signingSecret: SECRET,
        nowMs,
      }),
    ).toBe(false);
  });

  it("rejects missing signature/timestamp", () => {
    expect(
      verifySlackSignature({
        rawBody,
        signature: undefined,
        timestamp,
        signingSecret: SECRET,
        nowMs,
      }),
    ).toBe(false);
  });
});

describe("parseSlackCommand / resolveUserId", () => {
  it("parses the urlencoded slash-command body", () => {
    const cmd = parseSlackCommand(
      "command=%2Fpointbot&text=ask+best+transfer&user_id=U42",
    );
    expect(cmd).toEqual({
      command: "/pointbot",
      text: "ask best transfer",
      userId: "U42",
    });
  });

  it("prefers the configured default user id (self-hosted mode)", () => {
    expect(resolveUserId("owner", "U42")).toBe("owner");
    expect(resolveUserId(undefined, "U42")).toBe("U42");
  });
});
