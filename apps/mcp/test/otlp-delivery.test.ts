import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { context, metrics as otelMetrics, propagation, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  createConsoleLogger, createOtelMetrics, createOtelTracer, runWithRequestContext,
  type Observability,
} from "@pointup/core/observability";
import { PROVIDER_KINDS } from "@pointup/core/providers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpServer, shutdown } from "../src/http";

const TOKEN = "pu_abcdefghijklmnopqrstuvwxyz0123456789";
const PRIVATE = "PRIVATE_OTLP_PROVIDER_PAYLOAD";
const TOOL = "pointup_get_portfolio_summary";
const EXPORT_HEADER = "synthetic-collector-authorization";
const zero = { accounts: 0, points: 0, valueCents: 0 };
const SUMMARY = {
  totalPoints: 1, totalValueCents: 1, accountCount: 1,
  byKind: Object.fromEntries(PROVIDER_KINDS.map(kind => [kind, zero])), lastSyncedAt: null,
};

type Attribute = { key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number } };
type WireSpan = {
  name: string; traceId: string; spanId: string; parentSpanId?: string;
  startTimeUnixNano: string; endTimeUnixNano: string; attributes?: Attribute[];
  events?: { name: string; attributes?: Attribute[] }[];
  status?: { code?: number; message?: string };
};
type Point = { attributes?: Attribute[]; asInt?: string; asDouble?: number };
type WireMetric = { name: string; sum?: { dataPoints: Point[] }; gauge?: { dataPoints: Point[] }; histogram?: { dataPoints: { count: string }[] } };
type Payload = {
  resourceSpans?: { resource: { attributes: Attribute[] }; scopeSpans: { spans: WireSpan[] }[] }[];
  resourceMetrics?: { resource: { attributes: Attribute[] }; scopeMetrics: { metrics: WireMetric[] }[] }[];
};
type Delivery = { path: string; header: string | string[] | undefined; contentType: string | undefined; body: string; payload: Payload };
const attributes = (values: Attribute[] = []) => Object.fromEntries(values.map(({ key, value }) => [key, value.stringValue ?? value.intValue ?? value.doubleValue]));
const spans = (deliveries: Delivery[]) => deliveries.flatMap(delivery => delivery.payload.resourceSpans?.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans)) ?? []);
const exportedMetrics = (deliveries: Delivery[]) => deliveries.flatMap(delivery => delivery.payload.resourceMetrics?.flatMap(resource => resource.scopeMetrics.flatMap(scope => scope.metrics)) ?? []);
const listen = (server: Server) => new Promise<string>(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
const close = async (server: Server) => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); };

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  try { await dispose?.(); } finally {
    dispose = undefined;
    trace.disable(); context.disable(); propagation.disable(); otelMetrics.disable();
    vi.unstubAllEnvs();
  }
});

async function fixture(rejectCollector = false) {
  const deliveries: Delivery[] = [], lines: Record<string, unknown>[] = [], upstreamRequestIds: string[] = [];
  let failUpstream = false;
  const servers: Server[] = [];
  const owned: { mcp?: Server; provider?: NodeTracerProvider; meter?: MeterProvider } = {};
  // Install cleanup before any asynchronous setup or assertion can fail.
  dispose = async () => {
    if (owned.mcp?.listening) await shutdown(owned.mcp, 500);
    for (const server of servers.slice(1)) if (server.listening) await close(server);
    await Promise.allSettled([owned.provider?.shutdown(), owned.meter?.shutdown()]);
    if (servers[0]?.listening) await close(servers[0]);
  };
  const collector = createServer((request, response) => {
    const chunks: Buffer[] = []; let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 512 * 1024) request.destroy(new Error("Synthetic collector payload limit"));
      else chunks.push(chunk);
    });
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      deliveries.push({ path: request.url ?? "", header: request.headers["x-pointup-test-exporter"], contentType: request.headers["content-type"], body, payload: JSON.parse(body) as Payload });
      response.writeHead(rejectCollector ? 400 : 200, { "Content-Type": "application/json" }).end("{}");
    });
  });
  servers.push(collector);
  const endpoint = await listen(collector);
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint);
  vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", `${endpoint}/v1/traces`);
  vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", `${endpoint}/v1/metrics`);
  vi.stubEnv("OTEL_EXPORTER_OTLP_HEADERS", `x-pointup-test-exporter=${EXPORT_HEADER}`);
  vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "");
  vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_HEADERS", "");
  vi.stubEnv("OTEL_EXPORTER_OTLP_COMPRESSION", "none");
  vi.stubEnv("OTEL_EXPORTER_OTLP_TIMEOUT", "1000");
  vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", "none");
  vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_COMPRESSION", "none");
  vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "1000");
  vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_TIMEOUT", "1000");
  // Hosts compose the API adapters before registering SDK providers.
  const obs: Observability = {
    tracer: createOtelTracer(), metrics: createOtelMetrics(),
    logger: createConsoleLogger({ write: line => { lines.push(JSON.parse(line) as Record<string, unknown>); } }),
  };
  obs.metrics.counter("mcp_tool_calls_total", { tool: TOOL, outcome: "ok" }, 7);
  obs.metrics.histogram("http_request_duration_ms", 777, { route: "/pre-registration", method: "GET" });
  obs.metrics.gauge("db_ping_latency_ms", 17);
  const resource = resourceFromAttributes({ "service.name": "pointup-otlp-local-test" });
  const provider = new NodeTracerProvider({ resource, spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter(), { scheduledDelayMillis: 60_000, exportTimeoutMillis: 2000 })] });
  owned.provider = provider;
  provider.register();
  const meter = new MeterProvider({ resource, readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 60_000, exportTimeoutMillis: 2000 })] });
  owned.meter = meter;
  expect(otelMetrics.setGlobalMeterProvider(meter)).toBe(true);
  const upstream = createServer((request, response) => {
    upstreamRequestIds.push(String(request.headers["x-request-id"] ?? ""));
    response.writeHead(failUpstream ? 500 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(failUpstream ? { error: { code: "INTERNAL", message: PRIVATE } } : SUMMARY));
  });
  servers.push(upstream);
  const mcp = createHttpServer({ baseUrl: await listen(upstream), observability: obs, allowedOrigins: [] });
  owned.mcp = mcp;
  const mcpUrl = await listen(mcp);
  async function call(requestId: string) {
    const client = new Client({ name: "local-otlp-delivery", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}`, "X-Request-Id": requestId } } }));
      return await client.callTool({ name: TOOL, arguments: {} });
    } finally { await client.close(); }
  }
  return { obs, provider, meter, deliveries, lines, upstreamRequestIds, mcpUrl, call, fail: () => { failUpstream = true; } };
}

describe("actual local OTLP HTTP delivery", () => {
  it("delivers correlated real MCP spans and metrics without private credentials or provider errors", async () => {
    const f = await fixture();
    expect((await f.call("req-otlp-success-01")).isError).toBeFalsy();
    f.fail();
    const failed = await f.call(`prefix-${TOKEN}`);
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain(PRIVATE);
    const response = await fetch(`${f.mcpUrl}/healthz`, { headers: { "X-Request-Id": TOKEN } });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const error = Object.assign(new Error(PRIVATE, { cause: TOKEN }), { name: PRIVATE, code: "ASSISTANT_UNAVAILABLE", data: PRIVATE });
    await expect(runWithRequestContext({ requestId: "req-otlp-private-01" }, () => f.obs.tracer.withSpan("synthetic.private_failure", { "request.id": "req-otlp-private-01", "exception.message": PRIVATE }, async span => {
      span.setAttributes({ "exception.stacktrace": PRIVATE, "error.message": PRIVATE });
      f.obs.logger.error("synthetic_failure", { error });
      throw error;
    }))).rejects.toBe(error);
    await f.provider.forceFlush();
    await f.meter.forceFlush();

    expect(f.deliveries.some(delivery => delivery.path === "/v1/traces")).toBe(true);
    expect(f.deliveries.some(delivery => delivery.path === "/v1/metrics")).toBe(true);
    for (const delivery of f.deliveries) {
      expect(delivery.header).toBe(EXPORT_HEADER);
      expect(delivery.contentType).toContain("application/json");
      expect(delivery.body).not.toMatch(/PRIVATE_OTLP|pu_abcdefghijklmnopqrstuvwxyz/);
      const resources = delivery.payload.resourceSpans ?? delivery.payload.resourceMetrics ?? [];
      expect(resources.every(item => attributes(item.resource.attributes)["service.name"] === "pointup-otlp-local-test")).toBe(true);
    }
    const wire = spans(f.deliveries), toolSpans = wire.filter(span => span.name === `mcp.tool ${TOOL}`);
    expect(toolSpans).toHaveLength(2);
    expect(toolSpans.map(span => attributes(span.attributes)["mcp.outcome"]).sort()).toEqual(["error", "ok"]);
    for (const span of toolSpans) {
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/); expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(span.startTimeUnixNano));
      expect(wire.some(parent => parent.spanId === span.parentSpanId && parent.traceId === span.traceId)).toBe(true);
      expect(f.lines.find(line => line.msg === "mcp_tool_call" && line.requestId === attributes(span.attributes)["request.id"])).toMatchObject({
        traceId: span.traceId, spanId: span.parentSpanId, outcome: attributes(span.attributes)["mcp.outcome"],
      });
    }
    expect(wire.some(span => span.name === "GET /healthz" && attributes(span.attributes)["request.id"] === response.headers.get("x-request-id"))).toBe(true);
    expect(f.upstreamRequestIds).toContain("req-otlp-success-01");
    expect(f.upstreamRequestIds.filter(id => id !== "req-otlp-success-01").every(id => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    const privateSpan = wire.find(span => span.name === "synthetic.private_failure");
    expect(privateSpan?.status).toEqual({ code: 2, message: "Operation failed" });
    expect(attributes(privateSpan?.attributes)).toMatchObject({ "error.category": "operation_failed", "error.code": "ASSISTANT_UNAVAILABLE" });
    expect(privateSpan?.events?.map(event => ({ name: event.name, attributes: attributes(event.attributes) }))).toEqual([{ name: "exception", attributes: { "exception.type": "OperationError", "exception.message": "Operation failed" } }]);
    const log = f.lines.find(line => line.msg === "synthetic_failure");
    expect(log).toMatchObject({ requestId: "req-otlp-private-01", traceId: privateSpan?.traceId, spanId: privateSpan?.spanId });
    expect(JSON.stringify(f.lines)).not.toMatch(/PRIVATE_OTLP|pu_abcdefghijklmnopqrstuvwxyz/);
    expect(error.message).toBe(PRIVATE); expect(error.cause).toBe(TOKEN);
    const counter = exportedMetrics(f.deliveries).find(metric => metric.name === "mcp_tool_calls_total");
    expect(counter?.sum?.dataPoints.map(point => ({ labels: attributes(point.attributes), value: Number(point.asInt ?? point.asDouble) })).sort((a, b) => String(a.labels.outcome).localeCompare(String(b.labels.outcome)))).toEqual([
      { labels: { tool: TOOL, outcome: "error" }, value: 1 }, { labels: { tool: TOOL, outcome: "ok" }, value: 1 },
    ]);
    expect(exportedMetrics(f.deliveries).some(metric => metric.name === "http_request_duration_ms" && metric.histogram?.dataPoints.some(point => Number(point.count) > 0))).toBe(true);
    expect(JSON.stringify(exportedMetrics(f.deliveries))).not.toContain("/pre-registration");
    const gauge = exportedMetrics(f.deliveries).find(metric => metric.name === "db_ping_latency_ms");
    expect(gauge?.gauge?.dataPoints.map(point => Number(point.asInt ?? point.asDouble))).toEqual([17]);
  }, 15_000);

  it("keeps successful application replies when the collector rejects actual exports", async () => {
    const f = await fixture(true);
    expect((await f.call("req-otlp-rejected-01")).isError).toBeFalsy();
    await expect(f.provider.forceFlush()).rejects.toBeDefined();
    await f.meter.forceFlush();
    expect(f.deliveries.some(delivery => delivery.path === "/v1/traces")).toBe(true);
    expect(f.deliveries.some(delivery => delivery.path === "/v1/metrics")).toBe(true);
    expect((await f.call("req-otlp-after-rejection-01")).isError).toBeFalsy();
    expect(f.lines.filter(line => line.msg === "mcp_tool_call").map(line => line.outcome)).toEqual(["ok", "ok"]);
    expect(JSON.stringify(f.deliveries.map(delivery => delivery.payload))).not.toContain(TOKEN);
  }, 15_000);
});
