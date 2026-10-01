#!/usr/bin/env node
import { createServer, type IncomingMessage } from "node:http";

import { createPointUpClient } from "@pointup/api-client";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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

const baseUrl = (process.env.POINTUP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const agentName = process.env.POINTUP_AGENT_NAME ?? "mcp";

function bearer(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer pu_") ? header.slice(7).trim() : null;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

async function main() {
  if (process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http") {
    const port = Number(process.env.PORT ?? 8787);
    createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/healthz") {
        response.writeHead(200).end("ok");
        return;
      }
      if (url.pathname !== "/mcp") {
        response.writeHead(404).end();
        return;
      }
      const token = bearer(request);
      if (!token) {
        response
          .writeHead(401, { "WWW-Authenticate": 'Bearer realm="pointup"' })
          .end(JSON.stringify({ error: "Bearer pu_... token required" }));
        return;
      }
      try {
        // Stateless: a fresh server + transport per request, token-scoped.
        const server = createPointUpMcpServer({
          client: createPointUpClient({
            baseUrl,
            headers: { Authorization: `Bearer ${token}` },
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
        await transport.handleRequest(request, response, await readJson(request));
      } catch (error) {
        console.error("mcp request failed", error);
        if (!response.headersSent) response.writeHead(500).end();
      }
    }).listen(port, () => {
      console.error(`pointup-mcp listening on :${port}/mcp -> ${baseUrl}`);
    });
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
