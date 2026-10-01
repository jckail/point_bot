import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PROVIDER_KINDS } from "@pointup/core/providers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createHttpServer, shutdown } from "../src/http";

const zero = { accounts: 0, points: 0, valueCents: 0 };
const SUMMARY = {
  totalPoints: 1234,
  totalValueCents: 1200,
  accountCount: 1,
  byKind: Object.fromEntries(PROVIDER_KINDS.map((k) => [k, zero])),
  lastSyncedAt: null,
};

let upstream: Server;
let mcp: Server;
let mcpUrl: string;
const upstreamCalls: { path: string; auth?: string }[] = [];

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

beforeAll(async () => {
  upstream = createServer((req, res) => {
    upstreamCalls.push({ path: req.url ?? "", auth: req.headers.authorization });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(req.url?.startsWith("/api/v1/summary") ? SUMMARY : []));
  });
  const upstreamUrl = await listen(upstream);
  mcp = createHttpServer({
    baseUrl: upstreamUrl,
    agentName: "http-test",
    allowedOrigins: ["https://claude.ai"],
    maxBodyBytes: 2000,
  });
  mcpUrl = await listen(mcp);
});

afterAll(async () => {
  await shutdown(mcp, 500);
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
});

describe("MCP over HTTP", () => {
  it("serves /healthz without auth", async () => {
    const res = await fetch(`${mcpUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("answers 401 with a WWW-Authenticate resource metadata hint when the token is missing", async () => {
    const res = await fetch(`${mcpUrl}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(
      /^Bearer realm="pointup", resource_metadata=".*\/\.well-known\/oauth-protected-resource"$/,
    );
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
    const bad = await fetch(`${mcpUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_not_ours" },
      body: "{}",
    });
    expect(bad.status).toBe(401);
    const meta = await fetch(`${mcpUrl}/.well-known/oauth-protected-resource`);
    expect(await meta.json()).toMatchObject({ resource: `${mcpUrl}/mcp` });
  });

  it("handles CORS preflight and only echoes allowed origins", async () => {
    const ok = await fetch(`${mcpUrl}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "https://claude.ai" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(ok.headers.get("access-control-allow-headers")).toContain("Authorization");
    const bad = await fetch(`${mcpUrl}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(bad.status).toBe(403);
  });

  it("rejects oversized and malformed bodies, and non-POST methods", async () => {
    const headers = { Authorization: "Bearer pu_x", "Content-Type": "application/json" };
    const big = await fetch(`${mcpUrl}/mcp`, { method: "POST", headers, body: "x".repeat(5000) });
    expect(big.status).toBe(413);
    const bad = await fetch(`${mcpUrl}/mcp`, { method: "POST", headers, body: "{nope" });
    expect(bad.status).toBe(400);
    const get = await fetch(`${mcpUrl}/mcp`, { method: "GET", headers });
    expect(get.status).toBe(405);
  });

  it("round-trips a tool call and forwards the bearer token upstream", async () => {
    upstreamCalls.length = 0;
    const client = new Client({ name: "http-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
        requestInit: { headers: { Authorization: "Bearer pu_secret123" } },
      }),
    );
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain("pointup_get_portfolio_summary");

    const result = await client.callTool({
      name: "pointup_get_portfolio_summary",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ totalPoints: 1234 });
    expect(upstreamCalls).toEqual([
      { path: "/api/v1/summary", auth: "Bearer pu_secret123" },
    ]);
    await client.close();
  });

  it("rejects unknown Host headers (DNS rebinding) but keeps /healthz open", async () => {
    const hostFetch = (host: string, path = "/.well-known/oauth-protected-resource") =>
      new Promise<number>((resolve, reject) => {
        const { port } = new URL(mcpUrl);
        const req = httpRequest({ host: "127.0.0.1", port, path, headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
    expect(await hostFetch("evil.example")).toBe(403);
    expect(await hostFetch("evil.example:8787")).toBe(403);
    expect(await hostFetch("localhost:8787")).toBe(200);
    expect(await hostFetch("127.0.0.1")).toBe(200);
    expect(await hostFetch("evil.example", "/healthz")).toBe(200);
  });

  it("honours an explicit Host allow-list, and has no wildcard origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const prod = createHttpServer({
      baseUrl: "http://127.0.0.1:1",
      allowedHosts: ["mcp.example.com"],
    });
    vi.unstubAllEnvs();
    const url = await listen(prod);
    try {
      const wrongHost = await fetch(`${url}/mcp`, { method: "POST", body: "{}" });
      expect(wrongHost.status).toBe(403);
    } finally {
      await shutdown(prod, 200);
    }
    vi.stubEnv("NODE_ENV", "production");
    const prod2 = createHttpServer({ baseUrl: "http://127.0.0.1:1" });
    vi.unstubAllEnvs();
    const url2 = await listen(prod2);
    try {
      const withOrigin = await fetch(`${url2}/mcp`, {
        method: "OPTIONS",
        headers: { Origin: "https://anything.example" },
      });
      expect(withOrigin.status).toBe(403);
      const noOrigin = await fetch(`${url2}/mcp`, { method: "POST", body: "{}" });
      expect(noOrigin.status).toBe(401);
    } finally {
      await shutdown(prod2, 200);
    }
  });

  it("sheds load beyond maxInFlight with 503", async () => {
    const busy = createHttpServer({ baseUrl: "http://127.0.0.1:1", maxInFlight: 0 });
    const url = await listen(busy);
    try {
      const res = await fetch(`${url}/mcp`, {
        method: "POST",
        headers: { Authorization: "Bearer pu_x" },
        body: "{}",
      });
      expect(res.status).toBe(503);
    } finally {
      await shutdown(busy, 200);
    }
  });

  it("logs only error name and message, never the error object or tokens", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = createHttpServer({
      baseUrl: "http://127.0.0.1:1",
      fetch: () => {
        const error = new Error("boom") as Error & { headers?: unknown };
        error.headers = { authorization: "Bearer pu_leaky" };
        throw error;
      },
    });
    const url = await listen(failing);
    try {
      await fetch(`${url}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer pu_leaky",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "pointup_get_portfolio_summary", arguments: {} },
        }),
      });
    } finally {
      await shutdown(failing, 200);
    }
    for (const call of spy.mock.calls) {
      expect(call.every((arg) => typeof arg === "string")).toBe(true);
      expect(call.join(" ")).not.toContain("pu_leaky");
    }
    spy.mockRestore();
  });
});
