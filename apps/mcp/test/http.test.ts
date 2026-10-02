import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, request, type Server } from "node:http";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadHttpConfig } from "../src/http.js";

const listen = (server: Server) => new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
const close = (server: Server) => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
let api: Server;
let child: ChildProcess;
let origin: string;
const calls: { token: string; path: string }[] = [];

beforeAll(async () => {
  api = createServer((req, res) => {
    const token = req.headers.authorization ?? "";
    calls.push({ token, path: req.url ?? "" });
    setTimeout(() => {
      if (token === "Bearer pu_revoked") { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { code: "pu_revoked", message: "pu_revoked" } })); return; }
      if (req.url === "/api/v1/goals") { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "private-upstream-detail" } })); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(req.url === "/api/v1/assistant/actions" ? { action: { owner: token } } : { owner: token }));
    }, token === "Bearer pu_slow" ? 200 : token === "Bearer pu_alice" ? 30 : 5);
  });
  const apiPort = await listen(api);
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  origin = `http://127.0.0.1:${port}`;
  await promisify(execFile)("../../node_modules/.bin/esbuild", [ "src/index.ts", "--bundle", "--platform=node", "--target=node22", "--format=esm", "--outfile=dist/index.js"]);
  const env: NodeJS.ProcessEnv = { ...process.env, POINTUP_MCP_TRANSPORT: "http", POINTUP_MCP_PORT: String(port), POINTUP_API_URL: `http://127.0.0.1:${apiPort}`, POINTUP_ALLOW_WRITES: "true" };
  delete env.POINTUP_AGENT_TOKEN;
  delete env.POINTUP_SESSION_TOKEN;
  delete env.POINTUP_MCP_PUBLIC_ORIGIN;
  delete env.POINTUP_MCP_TRUST_HTTPS_PROXY;
  child = spawn(process.execPath, ["dist/index.js"], { env, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${origin}/mcp`); return; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  throw new Error("Compiled MCP process did not start.");
}, 20_000);
afterAll(async () => { child?.kill(); if (api) await close(api); });

async function connect(token: string) {
  const client = new Client({ name: "http-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

const post = (body: string, headers: Record<string, string> = {}) => fetch(`${origin}/mcp`, { method: "POST", headers: { Authorization: "Bearer pu_alice", "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body });

describe("compiled private HTTP MCP", () => {
  it("initializes, discovers, and overlaps two owners without credential sharing", async () => {
    const [alice, bob] = await Promise.all([connect("pu_alice"), connect("pu_bob")]);
    try {
      expect((await alice.listTools()).tools).toHaveLength(10);
      const [a, b] = await Promise.all([alice.callTool({ name: "portfolio_summary" }), bob.callTool({ name: "portfolio_summary" })]);
      expect(JSON.stringify(a)).toContain("Bearer pu_alice");
      expect(JSON.stringify(a)).not.toContain("pu_bob");
      expect(JSON.stringify(b)).toContain("Bearer pu_bob");
      expect(JSON.stringify(b)).not.toContain("pu_alice");
      const error = await alice.callTool({ name: "list_goals" });
      expect(error.isError).toBe(true);
      expect(JSON.stringify(error)).not.toContain("private-upstream-detail");
      const proposal = await bob.callTool({ name: "record_balance", arguments: { accountId: "account", points: 1 } });
      expect(JSON.stringify(proposal)).toContain("requiresBrowserApproval");
      expect(calls.filter(call => call.path === "/api/v1/assistant/actions")).toEqual([{ token: "Bearer pu_bob", path: "/api/v1/assistant/actions" }]);
      expect((await alice.listTools()).tools.some(tool => /approve/.test(tool.name))).toBe(false);
    } finally { await Promise.all([alice.close(), bob.close()]); }
  });

  it("rejects revoked PATs before initialize and never echoes the credential", async () => {
    const response = await post('{"jsonrpc":"2.0","id":1,"method":"initialize"}', { Authorization: "Bearer pu_revoked" });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("pu_revoked");
  });

  it("bounds bodies and rejects malformed JSON, origins, hosts, session IDs, credentials, and content types", async () => {
    expect((await post("{")).status).toBe(400);
    expect((await post("x".repeat(32_769))).status).toBe(413);
    for (const [headers, status] of [
      [{ Origin: "https://evil.test" }, 403],
      [{ "Content-Type": "text/plain" }, 415], [{ Authorization: "Bearer session" }, 401],
      [{ "Mcp-Session-Id": "another-user" }, 400],
    ] as const) expect((await post("{}", headers)).status).toBe(status);
    const hostStatus = await new Promise<number>(resolve => {
      const req = request(`${origin}/mcp`, { method: "POST", headers: { Host: "evil.test", Authorization: "Bearer pu_alice", "Content-Type": "application/json" } }, res => { res.resume(); resolve(res.statusCode!); });
      req.end("{}");
    });
    expect(hostStatus).toBe(403);
    expect((await fetch(`${origin}/mcp?token=pu_alice`)).status).toBe(404);
    expect((await fetch(`${origin}/mcp`)).status).toBe(405);
  });

  it("bounds a chunked request without relying on Content-Length", async () => {
    const status = await new Promise<number>(resolve => {
      const req = request(`${origin}/mcp`, { method: "POST", headers: { Authorization: "Bearer pu_alice", "Content-Type": "application/json", "Transfer-Encoding": "chunked" } }, res => { res.resume(); resolve(res.statusCode!); });
      req.write("x".repeat(20_000)); req.end("x".repeat(20_000));
    });
    expect(status).toBe(413);
  });
  it("caps simultaneous work and request frequency", async () => {
    const responses = await Promise.all(Array.from({ length: 18 }, () => post("{}", { Authorization: "Bearer pu_slow" })));
    expect(responses.filter(response => response.status === 429).length).toBeGreaterThanOrEqual(2);
    const statuses: number[] = [];
    for (let i = 0; i < 120; i++) statuses.push((await post("{")).status);
    expect(statuses).toContain(429);
    expect((await post("{")).headers.get("Retry-After")).toBe("60");
  });
});

it("requires explicit HTTPS proxy trust and disallows process credentials in HTTP mode", () => {
  const env = { POINTUP_API_URL: "https://pointup.test" };
  expect(loadHttpConfig(env).port).toBe(3001);
  expect(() => loadHttpConfig({ ...env, POINTUP_AGENT_TOKEN: "pu_secret" })).toThrow();
  expect(() => loadHttpConfig({ ...env, POINTUP_MCP_PUBLIC_ORIGIN: "https://mcp.test" })).toThrow();
  expect(() => loadHttpConfig({ ...env, POINTUP_MCP_PUBLIC_ORIGIN: "http://mcp.test", POINTUP_MCP_TRUST_HTTPS_PROXY: "true" })).toThrow();
  expect(loadHttpConfig({ ...env, POINTUP_MCP_PUBLIC_ORIGIN: "https://mcp.test", POINTUP_MCP_TRUST_HTTPS_PROXY: "true" }).publicOrigin).toBe("https://mcp.test");
});
