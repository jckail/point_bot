import { describe, expect, it, vi } from "vitest";
import { PointUpClient } from "@pointup/api-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, createToolService } from "../src/server.js";
import { clientFromConfig, loadConfig } from "../src/config.js";

function fixture(response = Response.json({ points: 123 })) {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
  const client = new PointUpClient({ baseUrl: "https://pointup.test", headers: { Authorization: "Bearer private-session" }, fetch: fetchImpl });
  return { fetchImpl, service: createToolService(client), client };
}

describe("MCP tools", () => {
  it("discovers and calls tools through a real MCP session", async () => {
    const { client, fetchImpl } = fixture();
    const server = createServer(client);
    const mcp = new Client({ name: "test", version: "1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    try {
      const tools = await mcp.listTools();
      expect(tools.tools).toHaveLength(8);
      const response = await mcp.callTool({ name: "portfolio_summary", arguments: {} });
      expect(response.content).toEqual([{ type: "text", text: '{"points":123}' }]);
      expect(fetchImpl).toHaveBeenCalledWith("https://pointup.test/api/v1/summary", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer private-session" }) }));
    } finally { await mcp.close(); await server.close(); }
  });

  it("rejects invalid limits, unknown fields, prototype names, and disabled writes before HTTP", async () => {
    const { fetchImpl, service } = fixture();
    for (const [name, args] of [
      ["balance_history", { accountId: "a", limit: 366 }],
      ["list_accounts", { userId: "another-user" }],
      ["toString", {}],
      ["record_balance", { accountId: "a", points: 100, confirmed: true }],
    ] as const) expect((await service.call(name, args)).isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates reviewed proposals and never writes balances directly", async () => {
    const { fetchImpl, client } = fixture();
    const service = createToolService(client, true);
    expect((await service.call("record_balance", { accountId: "a/b", points: 100, confirmed: true })).isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    const proposed = await service.call("record_balance", { accountId: "a/b", points: 100 });
    expect(JSON.stringify(proposed)).toContain("requiresBrowserApproval");
    expect(fetchImpl).toHaveBeenCalledWith("https://pointup.test/api/v1/assistant/actions", expect.objectContaining({ body: '{"kind":"manual_balance","accountId":"a/b","points":100}' }));
  });

  it("sanitizes upstream and network errors", async () => {
    const { service } = fixture(Response.json({ error: { code: "private-session", message: "private-session" } }, { status: 401 }));
    const result = await service.call("portfolio_summary", {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("expired");
    expect(JSON.stringify(result)).not.toContain("private-session");
    const network = fixture();
    network.fetchImpl.mockRejectedValue(new Error("private-session"));
    expect(JSON.stringify(await network.service.call("portfolio_summary", {}))).not.toContain("private-session");
  });

  it("bounds successful output", async () => {
    const { service } = fixture(Response.json({ huge: "a".repeat(128_001) }));
    expect(JSON.stringify(await service.call("portfolio_summary", {}))).toContain("RESULT_TOO_LARGE");
  });
});

describe("MCP configuration", () => {
  const env = { POINTUP_API_URL: "https://pointup.test", POINTUP_SESSION_TOKEN: "private-session" };
  it("defaults to read only and rejects insecure or credential-bearing origins", () => {
    expect(loadConfig(env).allowWrites).toBe(false);
    for (const origin of ["http://remote.test", "https://user:pass@pointup.test", "https://pointup.test/path", "https://pointup.test?token=x"]) {
      expect(() => loadConfig({ ...env, POINTUP_API_URL: origin })).toThrow();
    }
    expect(loadConfig({ ...env, POINTUP_API_URL: "http://127.0.0.1:3000" }).baseUrl).toBe("http://127.0.0.1:3000");
  });
  it("accepts a user-created scoped PAT without falling back between credentials", () => {
    expect(loadConfig({ POINTUP_API_URL: "https://pointup.test", POINTUP_AGENT_TOKEN: "pu_inert-test" }).sessionToken).toBe("pu_inert-test");
    expect(() => loadConfig({ ...env, POINTUP_AGENT_TOKEN: "pu_inert-test" })).toThrow(/exactly one/);
  });
  it("does not include session input in validation errors", () => {
    expect(() => loadConfig({ ...env, POINTUP_SESSION_TOKEN: "secret token" })).toThrow(/Set POINTUP_API_URL/);
  });
  it("refuses to follow redirects with bearer credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await clientFromConfig(loadConfig(env)).listProviders();
      expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: "error" }));
    } finally { vi.unstubAllGlobals(); }
  });
});
