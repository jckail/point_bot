import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { clientFromConfig, loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { startHttpServer } from "./http.js";

try {
  if (process.env.POINTUP_MCP_TRANSPORT === "http") {
    await startHttpServer(process.env);
  } else if (!process.env.POINTUP_MCP_TRANSPORT || process.env.POINTUP_MCP_TRANSPORT === "stdio") {
    const config = loadConfig(process.env);
    await createServer(clientFromConfig(config), config.allowWrites).connect(new StdioServerTransport());
  } else throw new Error("Unknown MCP transport.");
} catch {
  // stdout is reserved for the MCP protocol. Never log token-bearing errors.
  console.error("PointUp MCP could not start. Check the transport and PointUp MCP configuration.");
  process.exitCode = 1;
}
