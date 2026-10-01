import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { createPointUpClient } from "@pointup/api-client";
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

/** Log name + message only: never the error object, headers or tokens. */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "non-error thrown";
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
      "WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version",
    );
    return true;
  }

  const server = createServer(async (request, response) => {
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
          "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
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
          headers: { Authorization: `Bearer ${token}` },
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }),
        appUrl: baseUrl,
        agentName,
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
      console.error(`mcp request failed: ${describeError(error)}`);
      if (!response.headersSent) json(response, 500, rpcError(-32603, "internal error"));
    } finally {
      inFlight--;
    }
  });
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
