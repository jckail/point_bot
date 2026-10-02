import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  PrometheusMetrics,
  createConsoleLogger,
  createOtelTracer,
  type Observability,
} from "@pointup/core/observability";
import { PROVIDER_KINDS } from "@pointup/core/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { context, trace } from "@opentelemetry/api";

import { createHttpServer, shutdown } from "../src/http";

const TOKEN = "pu_abcdefghijklmnopqrstuvwxyz0123456789";
const zero = { accounts: 0, points: 0, valueCents: 0 };
const SUMMARY = {
  totalPoints: 1,
  totalValueCents: 1,
  accountCount: 1,
  byKind: Object.fromEntries(PROVIDER_KINDS.map((k) => [k, zero])),
  lastSyncedAt: null,
};

let upstream: Server;
let mcp: Server;
let mcpUrl: string;
let failUpstream = false;
const upstreamRequestIds: (string | undefined)[] = [];
const lines: Record<string, unknown>[] = [];
const raw: string[] = [];
const metrics = new PrometheusMetrics();
const exported = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exported)] });

const obs: Observability = {
  logger: createConsoleLogger({
    write: (l) => {
      raw.push(l);
      lines.push(JSON.parse(l));
    },
  }),
  tracer: createOtelTracer(),
  metrics,
  prometheus: metrics,
};

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

beforeAll(async () => {
  provider.register();
  upstream = createServer((req, res) => {
    upstreamRequestIds.push(req.headers["x-request-id"] as string | undefined);
    if (failUpstream) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "INTERNAL", message: "x" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(SUMMARY));
  });
  mcp = createHttpServer({
    baseUrl: await listen(upstream),
    observability: obs,
    allowedOrigins: [],
  });
  mcpUrl = await listen(mcp);
});

afterAll(async () => {
  await shutdown(mcp, 500);
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await provider.shutdown();
  trace.disable();
  context.disable();
});

describe("MCP request correlation", () => {
  it("echoes an inbound x-request-id and mints one otherwise", async () => {
    const given = await fetch(`${mcpUrl}/healthz`, { headers: { "X-Request-Id": "req-from-caller-1" } });
    expect(given.headers.get("x-request-id")).toBe("req-from-caller-1");
    const minted = await fetch(`${mcpUrl}/healthz`);
    expect(minted.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const unsafe = await fetch(`${mcpUrl}/healthz`, { headers: { "X-Request-Id": "bad id with spaces" } });
    expect(unsafe.headers.get("x-request-id")).not.toContain(" ");
  });

  it("forwards the request id to the API and logs tool calls without the token", async () => {
    lines.length = 0;
    raw.length = 0;
    upstreamRequestIds.length = 0;
    const client = new Client({ name: "obs-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}`, "X-Request-Id": "req-trace-me-01" } },
      }),
    );
    const result = await client.callTool({ name: "pointup_get_portfolio_summary", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(upstreamRequestIds).toContain("req-trace-me-01");

    const toolLog = lines.find((l) => l.msg === "mcp_tool_call");
    expect(toolLog).toMatchObject({
      tool: "pointup_get_portfolio_summary",
      outcome: "ok",
      requestId: "req-trace-me-01",
    });
    expect(lines.some((l) => l.msg === "http_request" && l.requestId === "req-trace-me-01")).toBe(true);
    expect(raw.join("\n")).not.toContain(TOKEN);
    expect(metrics.render()).toContain(
      'mcp_tool_calls_total{outcome="ok",tool="pointup_get_portfolio_summary"} 1',
    );
    await client.close();
  });

  it("replaces a PAT mistakenly used as correlation before echo, upstream forwarding or trace export", async () => {
    const client = new Client({ name: "secret-correlation-test", version: "1" });
    upstreamRequestIds.length = 0;
    raw.length = 0;
    exported.reset();
    try {
      const response = await fetch(`${mcpUrl}/healthz`, { headers: { "X-Request-Id": TOKEN } });
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}`, "X-Request-Id": `prefix-${TOKEN}` } },
      }));
      expect((await client.callTool({ name: "pointup_get_portfolio_summary", arguments: {} })).isError).toBeFalsy();
      expect(upstreamRequestIds.length).toBeGreaterThan(0);
      expect(upstreamRequestIds.every(id => /^[0-9a-f-]{36}$/.test(id ?? ""))).toBe(true);
      await provider.forceFlush();
      const spans = exported.getFinishedSpans();
      expect(spans.some(span => span.name === "mcp.tool pointup_get_portfolio_summary")).toBe(true);
      expect(spans.every(span => /^[0-9a-f-]{36}$/.test(String(span.attributes["request.id"])))).toBe(true);
      expect(JSON.stringify(spans.map(span => ({ name: span.name, attributes: span.attributes, events: span.events })))).not.toContain(TOKEN);
      expect(raw.join("\n")).not.toContain(TOKEN);
    } finally {
      await client.close();
    }
  });

  it("counts failed tool calls as outcome=error and still never logs the token", async () => {
    failUpstream = true;
    lines.length = 0;
    const client = new Client({ name: "obs-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
    const result = await client.callTool({ name: "pointup_get_portfolio_summary", arguments: {} });
    failUpstream = false;
    expect(result.isError).toBe(true);
    expect(lines.find((l) => l.msg === "mcp_tool_call")).toMatchObject({ outcome: "error", level: "warn" });
    expect(metrics.render()).toContain(
      'mcp_tool_calls_total{outcome="error",tool="pointup_get_portfolio_summary"} 1',
    );
    expect(raw.join("\n")).not.toContain(TOKEN);
    await client.close();
  });

  it("records HTTP metrics with a bounded route label", async () => {
    await fetch(`${mcpUrl}/some/unknown/path/12345`, { headers: { Host: "localhost" } });
    const text = metrics.render();
    expect(text).toContain('http_requests_total{method="GET",route="other"');
    expect(text).not.toContain("12345");
  });

  it("records malformed targets and bounds nonstandard method labels", async () => {
    const call = (method: string, path: string) => new Promise<number>((resolve, reject) => {
      const request = httpRequest(mcpUrl, { method, path }, response => {
        response.resume();
        response.on("end", () => resolve(response.statusCode!));
      });
      request.on("error", reject);
      request.end();
    });
    expect(await call("GET", "http://[")).toBe(400);
    expect(await call("PROPFIND", "/healthz")).toBe(200);
    const text = metrics.render();
    expect(text).toContain('http_requests_total{method="GET",route="other",status_class="4xx"');
    expect(text).toContain('http_requests_total{method="OTHER",route="/healthz",status_class="2xx"');
    expect(text).not.toContain("PROPFIND");
    expect(raw.join("\n")).not.toContain("http://[");
  });
});
