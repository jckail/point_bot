import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { request, type ClientRequest, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BotUseCases } from "../src/commands";
import type { BotEnv } from "../src/env";
import { createBotServer, MAX_BOT_BODY_BYTES } from "../src/server";

const callbacks = vi.hoisted(() => ({ slack: vi.fn(), discord: vi.fn() }));
vi.mock("../src/slack", async (original) => ({
  ...await original<typeof import("../src/slack")>(), postToSlack: callbacks.slack,
}));
vi.mock("../src/discord", async (original) => ({
  ...await original<typeof import("../src/discord")>(), editDiscordReply: callbacks.discord,
}));

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
const servers: Server[] = [];
const clients = new Set<ClientRequest>();
const useCases: BotUseCases = {
  listAccounts: { execute: vi.fn(async () => []) },
  getValueAdvice: { execute: vi.fn() },
  chatWithAssistant: { execute: vi.fn(async () => ({ reply: "Synthetic success" })) },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCases.chatWithAssistant.execute).mockResolvedValue({ reply: "Synthetic success" });
  callbacks.slack.mockResolvedValue(undefined);
  callbacks.discord.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider network in HTTP tests"); }));
});
afterEach(async () => {
  for (const client of clients) client.destroy();
  clients.clear();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function start(overrides: Partial<BotEnv> = {}, bodyTimeoutMs = 1000) {
  const env: BotEnv = {
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1/synthetic",
    PORT: 8080, SLACK_SIGNING_SECRET: "synthetic-signing-key", DISCORD_PUBLIC_KEY: publicHex,
    ...overrides,
  };
  const server = createBotServer({ env, useCases, bodyTimeoutMs });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected owned loopback port");
  return address.port;
}
function slackHeaders(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": "v0=" + createHmac("sha256", "synthetic-signing-key").update(`v0:${timestamp}:${body}`).digest("hex"),
  };
}
function discordHeaders(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { "x-signature-timestamp": timestamp, "x-signature-ed25519": sign(null, Buffer.from(timestamp + body), privateKey).toString("hex") };
}
function send(port: number, path: string, body: string, headers: Record<string, string> = {}, finish = true) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const client = request({ hostname: "127.0.0.1", port, path, method: path === "/health" ? "GET" : "POST", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString("utf8") }));
    });
    clients.add(client);
    client.once("close", () => clients.delete(client));
    client.once("error", reject);
    client.flushHeaders();
    if (body) client.write(body);
    if (finish) client.end();
  });
}
function expectNoEffects() {
  expect(useCases.listAccounts.execute).not.toHaveBeenCalled();
  expect(useCases.getValueAdvice.execute).not.toHaveBeenCalled();
  expect(useCases.chatWithAssistant.execute).not.toHaveBeenCalled();
  expect(callbacks.slack).not.toHaveBeenCalled();
  expect(callbacks.discord).not.toHaveBeenCalled();
}
function expectPrivateLogs() {
  const calls = vi.mocked(console.error).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((args) => args.length === 1 && typeof args[0] === "string")).toBe(true);
  expect(JSON.stringify(calls)).not.toContain("PRIVATE_CANARY");
}

describe("actual bot HTTP request boundary", () => {
  it("accepts actual signed Discord ping without invoking portfolio/provider usecases", async () => {
    const body = JSON.stringify({ type: 1 });
    const port = await start();
    const response = await send(port, "/discord/interactions", body, discordHeaders(body));
    expect(response).toEqual({ status: 200, body: '{"type":1}' });
    expectNoEffects();
    expect(console.error).not.toHaveBeenCalled();
  });
  it.each(["slack", "discord"] as const)("keeps invalid %s signature401 with zero effects", async (platform) => {
    const body = platform === "slack"
      ? "text=ask+synthetic&user_id=synthetic"
      : JSON.stringify({ type: 1 });
    const headers = platform === "slack"
      ? { ...slackHeaders(body), "x-slack-signature": "v0=00" }
      : { ...discordHeaders(body), "x-signature-ed25519": "00".repeat(64) };
    const port = await start();
    const response = await send(port, platform === "slack" ? "/slack/commands" : "/discord/interactions", body, headers);
    expect(response).toEqual({ status: 401, body: '{"error":"invalid signature"}' });
    expectNoEffects();
    expect(console.error).not.toHaveBeenCalled();
  });
  it.each(["slack", "discord"] as const)("rejects oversized declared %s body before usecases and remains healthy", async (platform) => {
    const port = await start();
    const path = platform === "slack" ? "/slack/commands" : "/discord/interactions";
    const response = await send(port, path, "", { "content-length": String(MAX_BOT_BODY_BYTES + 1) });
    expect(response).toEqual({ status: 413, body: '{"error":"request body too large"}' });
    expectNoEffects();
    expect((await send(port, "/health", "")).status).toBe(200);
  });
  it.each(["slack", "discord"] as const)("rejects streamed UTF8 byte oversize for %s without auth/usecase effects", async (platform) => {
    const port = await start();
    const path = platform === "slack" ? "/slack/commands" : "/discord/interactions";
    const body = "é".repeat(MAX_BOT_BODY_BYTES / 2 + 1);
    expect(body.length).toBeLessThan(MAX_BOT_BODY_BYTES);
    expect((await send(port, path, body, { "transfer-encoding": "chunked" })).status).toBe(413);
    expectNoEffects();
    expect((await send(port, "/health", "")).status).toBe(200);
  });
  it("rejects streamed exactcap+1 ASCII bytes before command dispatch", async () => {
    const port = await start();
    const prefix = "text=ask+synthetic&user_id=synthetic&padding=";
    const body = prefix + "x".repeat(MAX_BOT_BODY_BYTES + 1 - Buffer.byteLength(prefix));
    expect(Buffer.byteLength(body)).toBe(MAX_BOT_BODY_BYTES + 1);
    expect((await send(port, "/slack/commands", body, { ...slackHeaders(body), "transfer-encoding": "chunked" })).status).toBe(413);
    expectNoEffects();
    expect((await send(port, "/health", "")).status).toBe(200);
  });
  it("accepts exactly64KiB signed Slack bytes and dispatches actual command", async () => {
    const prefix = "text=ask+synthetic&user_id=synthetic&padding=";
    const body = prefix + "x".repeat(MAX_BOT_BODY_BYTES - Buffer.byteLength(prefix));
    const port = await start();
    const response = await send(port, "/slack/commands", body, slackHeaders(body));
    expect(response.status).toBe(200);
    expect(response.body).toContain("Synthetic success");
    expect(useCases.chatWithAssistant.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "synthetic" }));
  });
  it("times out incomplete body through actual bounded policy, no sleep or usecase", async () => {
    const port = await start({}, 25);
    const response = await send(port, "/slack/commands", "partial", { "content-length": "100" }, false);
    expect(response).toEqual({ status: 408, body: '{"error":"request body timed out"}' });
    expectNoEffects();
    expect((await send(port, "/health", "")).status).toBe(200);
  });
  it("invalid length gets bounded HTTP400 and leaves health responsive", async () => {
    const port = await start();
    expect((await send(port, "/slack/commands", "", { "content-length": "not-a-number" })).status).toBe(400);
    expectNoEffects();
    expect((await send(port, "/health", "")).status).toBe(200);
  });
  it.each(["slack", "discord"] as const)("keeps valid signed %s inline command failure private", async (platform) => {
    const failure = new Error("PRIVATE_CANARY prompt/member/provider details");
    vi.mocked(useCases.chatWithAssistant.execute).mockRejectedValueOnce(failure);
    const body = platform === "slack" ? "text=ask+synthetic&user_id=synthetic" : JSON.stringify({ type: 2, token: "synthetic-token", user: { id: "synthetic" }, data: { name: "ask", options: [{ value: "ask synthetic" }] } });
    const port = await start();
    const response = await send(port, platform === "slack" ? "/slack/commands" : "/discord/interactions", body, platform === "slack" ? slackHeaders(body) : discordHeaders(body));
    expect(response.status).toBe(200);
    expect(response.body).toContain("Something went wrong");
    expect(response.body).not.toContain("PRIVATE_CANARY");
    expectPrivateLogs();
  });
  it.each(["slack", "discord"] as const)("preserves signed %s deferred acknowledgement and bounded failure reply without inspecting hostile value", async (platform) => {
    const getter = vi.fn(() => { throw new Error("PRIVATE_CANARY getter"); });
    const hostile = Object.defineProperty({}, "message", { get: getter });
    vi.mocked(useCases.chatWithAssistant.execute).mockRejectedValueOnce(hostile);
    const body = platform === "slack" ? "text=ask+synthetic&user_id=synthetic&response_url=https%3A%2F%2Fhooks.slack.com%2Factions%2Fsynthetic" : JSON.stringify({ type: 2, token: "synthetic-token", user: { id: "synthetic" }, data: { options: [{ value: "ask synthetic" }] } });
    const port = await start(platform === "discord" ? { DISCORD_APP_ID: "123" } : {});
    const response = await send(port, platform === "slack" ? "/slack/commands" : "/discord/interactions", body, platform === "slack" ? slackHeaders(body) : discordHeaders(body));
    expect(response.status).toBe(200);
    expect(response.body).toContain(platform === "slack" ? "On it" : '"type":5');
    const callback = platform === "slack" ? callbacks.slack : callbacks.discord;
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(callback.mock.calls[0]!.at(-1)).toBe("Something went wrong handling that command.");
    expect(getter).not.toHaveBeenCalled();
    expectPrivateLogs();
  });
  it("signed malformed Discord JSON receives generic error and fixed log without request fragment", async () => {
    const body = '{"PRIVATE_CANARY": ';
    const port = await start();
    const response = await send(port, "/discord/interactions", body, discordHeaders(body));
    expect(response).toEqual({ status: 500, body: '{"error":"internal error"}' });
    expectNoEffects();
    expectPrivateLogs();
  });
  it("an aborted incomplete client does not invoke a command or poison later requests", async () => {
    const port = await start();
    const server = servers.at(-1)!;
    let sawAbort = false;
    const observedClose = new Promise<void>((resolve) => {
      server.once("request", (incoming) => {
        incoming.once("aborted", () => { sawAbort = true; });
        incoming.once("close", resolve);
        // Server has entered its real request handler/readBody before disconnect.
        client.destroy();
      });
    });
    const client = request({ hostname: "127.0.0.1", port, path: "/slack/commands", method: "POST", headers: { "content-length": "100" } });
    clients.add(client);
    client.once("error", () => undefined);
    client.once("close", () => clients.delete(client));
    client.flushHeaders();
    client.write("partial");
    await observedClose;
    expect(sawAbort).toBe(true);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledExactlyOnceWith("[bot] request body rejected"));
    expect((await send(port, "/health", "")).status).toBe(200);
    expectNoEffects();
  });
});
