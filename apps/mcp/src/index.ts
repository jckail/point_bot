#!/usr/bin/env node
import { createPointUpClient } from "@pointup/api-client";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ensureObservability, otelConfigured } from "@pointup/core/observability";

import { createHttpServer, shutdown } from "./http";
import { createPointUpMcpServer } from "./server";

/**
 * Two transports, one server:
 *
 * - stdio (default): local MCP clients (Claude Code/Desktop, Cursor). The token
 *   comes from POINTUP_TOKEN.
 * - http (`--http`, or MCP_TRANSPORT=http): a stateless remote server (ChatGPT
 *   connectors, claude.ai custom connectors). Each request's own
 *   `Authorization: Bearer pu_...` header is forwarded to the API - the server
 *   never stores tokens.
 */

/**
 * Telemetry. Logs always go to stderr (stdout carries the stdio protocol).
 * The OpenTelemetry SDK + OTLP/HTTP exporters are loaded only when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise nothing is imported or started.
 */
async function startTelemetry(): Promise<() => Promise<void>> {
  const service = process.env.OTEL_SERVICE_NAME?.trim() || "pointup-mcp";
  ensureObservability({ service, write: (line) => process.stderr.write(`${line}\n`) });
  if (!otelConfigured()) return async () => {};
  try {
    const [
      { NodeTracerProvider, BatchSpanProcessor },
      { OTLPTraceExporter },
      { MeterProvider, PeriodicExportingMetricReader },
      { OTLPMetricExporter },
      { resourceFromAttributes },
      { metrics },
    ] = await Promise.all([
      import("@opentelemetry/sdk-trace-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/sdk-metrics"),
      import("@opentelemetry/exporter-metrics-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/api"),
    ]);
    const resource = resourceFromAttributes({ "service.name": service });
    const tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    });
    tracerProvider.register();
    const meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: 15_000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);
    return async () => {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
    };
  } catch (error) {
    console.error(`OpenTelemetry disabled: ${error instanceof Error ? error.message : "init failed"}`);
    return async () => {};
  }
}

const baseUrl = (process.env.POINTUP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const agentName = process.env.POINTUP_AGENT_NAME ?? "mcp";

async function main() {
  const flushTelemetry = await startTelemetry();
  if (process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http") {
    const port = Number(process.env.PORT ?? 8787);
    const list = (value?: string) => value?.split(",").map((v) => v.trim()).filter(Boolean);
    const origins = list(process.env.MCP_ALLOWED_ORIGINS);
    const hosts = list(process.env.MCP_ALLOWED_HOSTS);
    const server = createHttpServer({
      baseUrl,
      agentName,
      publicUrl: process.env.MCP_PUBLIC_URL,
      ...(origins ? { allowedOrigins: origins } : {}),
      ...(hosts ? { allowedHosts: hosts } : {}),
    });
    const host = process.env.HOST ?? "127.0.0.1";
    server.listen(port, host, () => {
      console.error(`pointup-mcp listening on ${host}:${port}/mcp -> ${baseUrl}`);
    });
    const stop = () => {
      console.error("pointup-mcp shutting down");
      void shutdown(server)
        .then(flushTelemetry)
        .then(() => process.exit(0));
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    return;
  }

  const token = process.env.POINTUP_TOKEN;
  if (!token?.startsWith("pu_")) {
    console.error(
      "POINTUP_TOKEN must be a PointUp personal access token (pu_...). Create one at " +
        `${baseUrl}/dashboard/agents`,
    );
    process.exit(1);
  }
  const server = createPointUpMcpServer({
    client: createPointUpClient({
      baseUrl,
      headers: { Authorization: `Bearer ${token}` },
    }),
    appUrl: baseUrl,
    agentName,
  });
  await server.connect(new StdioServerTransport());
}

void main();
