import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  discordMessage,
  parseDiscordInteraction,
  verifyDiscordSignature,
} from "../src/discord";

// A deterministic Ed25519 keypair for signing test requests.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");

function signDiscord(timestamp: string, rawBody: string): string {
  return sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");
}

describe("verifyDiscordSignature", () => {
  const rawBody = JSON.stringify({ type: 1 });
  const timestamp = "1760000000";

  it("accepts a correctly signed request", () => {
    expect(
      verifyDiscordSignature({
        rawBody,
        signature: signDiscord(timestamp, rawBody),
        timestamp,
        publicKeyHex,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(
      verifyDiscordSignature({
        rawBody: JSON.stringify({ type: 2 }),
        signature: signDiscord(timestamp, rawBody),
        timestamp,
        publicKeyHex,
      }),
    ).toBe(false);
  });

  it("rejects a bad signature / missing headers / bad key without throwing", () => {
    expect(
      verifyDiscordSignature({ rawBody, signature: "zz", timestamp, publicKeyHex }),
    ).toBe(false);
    expect(
      verifyDiscordSignature({ rawBody, signature: undefined, timestamp, publicKeyHex }),
    ).toBe(false);
    expect(
      verifyDiscordSignature({
        rawBody,
        signature: signDiscord(timestamp, rawBody),
        timestamp,
        publicKeyHex: "not-hex",
      }),
    ).toBe(false);
  });
});

describe("parseDiscordInteraction", () => {
  it("recognizes a PING", () => {
    expect(parseDiscordInteraction(JSON.stringify({ type: 1 }))).toEqual({
      type: "ping",
    });
  });

  it("reads command text from the first string option and the member user id", () => {
    const body = JSON.stringify({
      type: 2,
      token: "tok",
      data: { name: "pointbot", options: [{ name: "query", value: "portfolio" }] },
      member: { user: { id: "U9" } },
    });
    expect(parseDiscordInteraction(body)).toEqual({
      type: "command",
      commandText: "portfolio",
      userId: "U9",
      token: "tok",
    });
  });

  it("falls back to the command name and the top-level user id (DMs)", () => {
    const body = JSON.stringify({
      type: 2,
      token: "t2",
      data: { name: "expiring" },
      user: { id: "U-DM" },
    });
    expect(parseDiscordInteraction(body)).toEqual({
      type: "command",
      commandText: "expiring",
      userId: "U-DM",
      token: "t2",
    });
  });

  it("marks other interaction types unsupported", () => {
    expect(parseDiscordInteraction(JSON.stringify({ type: 5 }))).toEqual({
      type: "unsupported",
    });
  });
});

describe("discordMessage", () => {
  it("builds an ephemeral message and truncates to 2000 chars", () => {
    const msg = discordMessage("x".repeat(2500));
    expect(msg.type).toBe(4);
    expect(msg.data.flags).toBe(64);
    expect(msg.data.content).toHaveLength(2000);
  });
});
