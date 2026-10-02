import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { createPointUpClient } from "@pointup/api-client";
import {
  METRIC_NAMES,
  REQUEST_ID_HEADER,
  getObservability,
  resolveRequestId,
  runWithRequestContext,
  statusClass,
  type Observability,
} from "@pointup/core/observability";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createPointUpMcpServer } from "./server";

/**
 * Stateless remote MCP over Streamable HTTP. Each request carries its own
 * `Authorization: Bearer pu_...`, which is forwarded to the PointUp API; the
 * server never stores tokens.
 */

export interface HttpServerOptions {
  /** PointUp API base URL the caller's token is forwarded to. */
  readonly baseUrl: string;
  /** Explicit private server-to-server HTTP origin; never populated from callers. */
  readonly trustedHttpOrigin?: string;
  readonly agentName?: string;
  /** Public URL of this MCP server (for the auth metadata hint). */
  readonly publicUrl?: string;
  /**
   * Allowed browser origins, checked strictly whenever an Origin header is present.
   * Default: ["*"] outside production, [] (no browser origin) in production.
   * Tokens are bearer headers, never cookies.
   */
  readonly allowedOrigins?: readonly string[];
  /**
   * Allowed Host header values (hostname, port ignored) - DNS-rebinding defence.
   * Default: loopback names only. "*" disables the check. /healthz and /readyz are exempt
   * (load balancers probe by IP).
   */
  readonly allowedHosts?: readonly string[];
  /** Max concurrent in-flight /mcp requests; excess gets 503. Default 64. */
  readonly maxInFlight?: number;
  /** Socket-level timeouts in ms. */
  readonly requestTimeoutMs?: number;
  readonly headersTimeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly fetch?: typeof fetch;
  /** Telemetry sinks; defaults to the process-wide configuration. */
  readonly observability?: Observability;
}

const DEFAULT_MAX_BODY = 1_000_000;
const DEFAULT_MAX_IN_FLIGHT = 64;
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

/** Hostname of a Host header value, lowercased, port and IPv6 brackets stripped. */
function hostName(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    return end === -1 ? v : v.slice(1, end);
  }
  const colons = v.split(":").length - 1;
  return colons === 1 ? v.slice(0, v.indexOf(":")) : v;
}

/** Bounded route label: unknown paths must not become metric labels. */
function routeLabel(pathname: string): string {
  return ["/mcp", "/healthz", "/readyz", "/.well-known/oauth-protected-resource"].includes(pathname)
    ? pathname
    : "other";
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function bearer(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer pu_") ? header.slice(7).trim() : null;
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "payload too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function rpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

export function createHttpServer(options: HttpServerOptions): Server {
  const {
    baseUrl,
    agentName = "mcp",
    maxBodyBytes = DEFAULT_MAX_BODY,
    maxInFlight = DEFAULT_MAX_IN_FLIGHT,
  } = options;
  const allowedOrigins =
    options.allowedOrigins ?? (process.env.NODE_ENV === "production" ? [] : ["*"]);
  const allowedHosts = new Set(
    (options.allowedHosts?.length ? options.allowedHosts : LOOPBACK_HOSTS).map(hostName),
  );
  const anyHost = (options.allowedHosts ?? []).includes("*");
  let inFlight = 0;

  const publicBase = (request: IncomingMessage) =>
    (options.publicUrl ?? `http://${request.headers.host ?? "localhost"}`).replace(/\/$/, "");

  function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
    const origin = request.headers.origin;
    if (!origin) return true;
    const any = allowedOrigins.includes("*");
    if (!any && !allowedOrigins.includes(origin)) return false;
    response.setHeader("Access-Control-Allow-Origin", any ? "*" : origin);
    if (!any) response.setHeader("Vary", "Origin");
    response.setHeader(
      "Access-Control-Expose-Headers",
      "WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version, X-Request-Id",
    );
    return true;
  }

  const server = createServer((request, response) => {
    const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER] as string | undefined);
    response.setHeader("X-Request-Id", requestId);
    const obs = options.observability ?? getObservability();
    const started = performance.now();
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const route = routeLabel(pathname);
    response.once("finish", () => {
      const status = response.statusCode;
      obs.metrics.counter(METRIC_NAMES.http_requests_total, {
        route,
        method: request.method ?? "UNKNOWN",
        status_class: statusClass(status),
      });
      obs.metrics.histogram(METRIC_NAMES.http_request_duration_ms, performance.now() - started, {
        route,
        method: request.method ?? "UNKNOWN",
      });
      const probe = route === "/healthz" || route === "/readyz";
      obs.logger[status >= 500 ? "error" : probe ? "debug" : "info"]("http_request", {
        requestId,
        method: request.method,
        route,
        status,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      });
    });
    void runWithRequestContext({ requestId }, () =>
      obs.tracer.withSpan(
        `${request.method ?? "UNKNOWN"} ${route}`,
        { "http.request.method": request.method ?? "UNKNOWN", "http.route": route, "request.id": requestId },
        () => handle(request, response, requestId, obs),
      ),
    ).catch((error: unknown) => {
      obs.logger.error("mcp_request_failed", { requestId, error });
      if (!response.headersSent) json(response, 500, rpcError(-32603, "internal error"));
      else response.end();
    });
  });

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
    obs: Observability,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/healthz") {
      response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }

    if (url.pathname === "/readyz") {
      // Ready when the upstream PointUp API (and through it the database) is.
      try {
        const upstream = await (options.fetch ?? fetch)(`${baseUrl}/api/readyz`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
        response.writeHead(200, { "Content-Type": "text/plain" }).end("ready");
      } catch {
        response.writeHead(503, { "Content-Type": "text/plain" }).end("unavailable");
      }
      return;
    }

    const host = request.headers.host;
    if (!anyHost && (!host || !allowedHosts.has(hostName(host)))) {
      json(response, 403, { error: "host not allowed" });
      return;
    }

    if (!applyCors(request, response)) {
      json(response, 403, { error: "origin not allowed" });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, X-Request-Id",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }

    if (url.pathname === "/.well-known/oauth-protected-resource") {
      json(response, 200, {
        resource: `${publicBase(request)}/mcp`,
        bearer_methods_supported: ["header"],
        // No OAuth server yet: callers use a PointUp personal access token.
        authorization_servers: [],
        resource_name: "PointUp MCP",
        resource_documentation: `${baseUrl}/dashboard/agents`,
      });
      return;
    }

    if (url.pathname !== "/mcp") {
      json(response, 404, { error: "not found" });
      return;
    }

    const token = bearer(request);
    if (!token) {
      json(
        response,
        401,
        {
          error: "unauthorized",
          error_description: `Send "Authorization: Bearer pu_..." (create a personal access token at ${baseUrl}/dashboard/agents).`,
        },
        {
          "WWW-Authenticate": `Bearer realm="pointup", resource_metadata="${publicBase(request)}/.well-known/oauth-protected-resource"`,
        },
      );
      return;
    }

    if (request.method !== "POST") {
      // Stateless server: no SSE stream (GET) and no sessions (DELETE).
      json(response, 405, rpcError(-32000, "Method not allowed; use POST"), { Allow: "POST, OPTIONS" });
      return;
    }

    if (inFlight >= maxInFlight) {
      json(response, 503, rpcError(-32000, "server busy"), { "Retry-After": "1" });
      return;
    }
    inFlight++;
    try {
      const body = await readJson(request, maxBodyBytes);
      // Stateless: a fresh server + transport per request, token-scoped.
      const server = createPointUpMcpServer({
        client: createPointUpClient({
          baseUrl,
          ...(options.trustedHttpOrigin !== undefined ? { trustedHttpOrigin: options.trustedHttpOrigin } : {}),
          headers: { Authorization: `Bearer ${token}`, "X-Request-Id": requestId },
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }),
        appUrl: baseUrl,
        agentName,
        requestId,
        observability: obs,
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (error instanceof HttpError) {
        if (!response.headersSent) {
          json(response, error.status, rpcError(error.status === 400 ? -32700 : -32600, error.message));
        }
        return;
      }
      obs.logger.error("mcp_request_failed", { requestId, error });
      if (!response.headersSent) json(response, 500, rpcError(-32603, "internal error"));
    } finally {
      inFlight--;
    }
  }
  server.requestTimeout = options.requestTimeoutMs ?? 30_000;
  server.headersTimeout = options.headersTimeoutMs ?? 15_000;
  return server;
}

/** Closes the listener, then force-drops lingering connections after `graceMs`. */
export function shutdown(server: Server, graceMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
}
