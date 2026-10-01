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
  /** Allowed browser origins; "*" (default) allows any. Tokens are bearer headers, never cookies. */
  readonly allowedOrigins?: readonly string[];
  readonly maxBodyBytes?: number;
  readonly fetch?: typeof fetch;
}

const DEFAULT_MAX_BODY = 1_000_000;

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
    allowedOrigins = ["*"],
    maxBodyBytes = DEFAULT_MAX_BODY,
  } = options;

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

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

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

    if (url.pathname === "/healthz") {
      response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
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
      console.error("mcp request failed", error);
      if (!response.headersSent) json(response, 500, rpcError(-32603, "internal error"));
    }
  });
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
