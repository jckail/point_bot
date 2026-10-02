import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHttpServer, shutdown } from "../src/http";

/**
 * Tool definitions and schemas are shared module state. These tests prove the
 * per-request binding is airtight: parallel callers with different tokens each
 * reach the upstream with their own token, never another request's.
 */
let upstream: Server;
let mcp: Server;
let mcpUrl: string;
const seen: { auth?: string; withinDays: string | null }[] = [];

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

beforeAll(async () => {
  upstream = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    seen.push({ auth: req.headers.authorization, withinDays: url.searchParams.get("withinDays") });
    // Random latency so request lifetimes interleave.
    setTimeout(
      () => res.writeHead(200, { "Content-Type": "application/json" }).end("[]"),
      Math.floor(Math.random() * 25),
    );
  });
  mcp = createHttpServer({ baseUrl: await listen(upstream), allowedHosts: ["*"] });
  mcpUrl = await listen(mcp);
});

afterAll(async () => {
  await shutdown(mcp, 500);
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
});

const rpc = (token: string, id: number, body: unknown) =>
  fetch(`${mcpUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, ...(body as object) }),
  });

describe("per-request token isolation with shared tool definitions", () => {
  it("binds each parallel request to its own bearer token", async () => {
    seen.length = 0;
    const N = 60;
    const results = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        // withinDays encodes which caller issued the call (1..60).
        const res = await rpc(`pu_caller_${i + 1}`, i, {
          method: "tools/call",
          params: { name: "pointup_list_expiring", arguments: { withinDays: i + 1 } },
        });
        return { status: res.status, text: await res.text() };
      }),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.text).not.toContain('"isError":true');
    }
    expect(seen).toHaveLength(N);
    for (const call of seen) {
      expect(call.auth).toBe(`Bearer pu_caller_${call.withinDays}`);
    }
    expect(new Set(seen.map((c) => c.auth)).size).toBe(N);
  });

  it("keeps validating arguments with the shared schemas, per request", async () => {
    const bad = await rpc("pu_caller_x", 1, {
      method: "tools/call",
      params: { name: "pointup_list_expiring", arguments: { withinDays: 100000 } },
    });
    expect(await bad.text()).toMatch(/Invalid arguments|isError/);
    const good = await rpc("pu_caller_x", 2, {
      method: "tools/call",
      params: { name: "pointup_list_expiring", arguments: { withinDays: 5 } },
    });
    expect(await good.text()).not.toContain('"isError":true');
  });
});
