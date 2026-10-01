#!/usr/bin/env node
import { createPointUpClient } from "@pointup/api-client";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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

const baseUrl = (process.env.POINTUP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const agentName = process.env.POINTUP_AGENT_NAME ?? "mcp";

async function main() {
  if (process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http") {
    const port = Number(process.env.PORT ?? 8787);
    const server = createHttpServer({
      baseUrl,
      agentName,
      publicUrl: process.env.MCP_PUBLIC_URL,
      allowedOrigins: process.env.MCP_ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean),
    });
    server.listen(port, () => {
      console.error(`pointup-mcp listening on :${port}/mcp -> ${baseUrl}`);
    });
    const stop = () => {
      console.error("pointup-mcp shutting down");
      void shutdown(server).then(() => process.exit(0));
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
