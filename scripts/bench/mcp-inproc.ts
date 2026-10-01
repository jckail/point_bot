/**
 * MCP server overhead in isolation: the HTTP transport + McpServer + tool
 * dispatch against a stub upstream that answers instantly (no web app, no
 * database). Isolates exactly what the per-request server construction costs.
 *
 *   npx tsx scripts/bench/mcp-inproc.ts [--duration=8] [--connections=16] [--tokens=300]
 *
 * Every request carries one of `--tokens` distinct bearer tokens.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import autocannon from "autocannon";

import { createHttpServer } from "../../apps/mcp/src/http";
import { arg } from "./common";

const duration = Number(arg("duration", "8"));
const connections = Number(arg("connections", "16"));
const tokens = Number(arg("tokens", "300"));

const upstream = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" }).end("[]");
});
await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

const mcp = createHttpServer({
  baseUrl: upstreamUrl,
  allowedHosts: ["*"],
  maxInFlight: 10_000,
  observability: undefined,
});
await new Promise<void>((r) => mcp.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

const call = (name: string) =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } });

console.log(`\nMCP in-process | ${connections} connections | ${duration}s | ${tokens} tokens\n`);
console.log("| route | RPS | p50 ms | p97.5 ms | p99 ms | non-2xx | errors |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
for (const name of ["pointup_list_accounts", "pointup_list_providers"]) {
  let counter = 0;
  const r = await autocannon({
    url: base,
    connections,
    duration,
    requests: [
      {
        method: "POST",
        path: "/mcp",
        setupRequest: (req: Record<string, unknown>) => ({
          ...req,
          headers: {
            authorization: `Bearer pu_inproc_${counter++ % tokens}`,
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body: call(name),
        }),
      },
    ],
  });
  console.log(
    `| ${name} | ${Math.round(r.requests.average)} | ${r.latency.p50} | ${r.latency.p97_5} | ${r.latency.p99} | ${r.non2xx} | ${r.errors} |`,
  );
}
mcp.close();
upstream.close();
process.exit(0);
