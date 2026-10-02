/**
 * HTTP load benchmark (autocannon) against the built web app and/or the MCP
 * HTTP server, using bearer tokens seeded by seed.ts. Tokens rotate across
 * `--users` principals so the per-principal in-memory rate limiter (120
 * req/min) is not what is being measured.
 *
 *   npx tsx scripts/bench/http.ts --target=web [--base=http://127.0.0.1:3100]
 *       [--duration=10] [--connections=32] [--users=1500] [--routes=summary,accounts,...]
 *   npx tsx scripts/bench/http.ts --target=mcp --base=http://127.0.0.1:8787
 *
 * Prints p50/p97.5/p99 latency, RPS and non-2xx counts per route as a
 * markdown table. The server under test is started separately (see
 * docs/performance.md) so it can be profiled with --cpu-prof.
 */
import autocannon from "autocannon";

import { arg, benchToken } from "./common";

const target = arg("target", "web");
const base = arg("base", target === "mcp" ? "http://127.0.0.1:8787" : "http://127.0.0.1:3100");
const duration = Number(arg("duration", "10"));
const connections = Number(arg("connections", "32"));
const users = Number(arg("users", "1500"));
const only = arg("routes", "").split(",").filter(Boolean);

interface Route {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: (token: string) => string;
}

const webRoutes: Route[] = [
  { name: "summary", method: "GET", path: "/api/v1/summary" },
  { name: "accounts", method: "GET", path: "/api/v1/loyalty-accounts" },
  { name: "expiring", method: "GET", path: "/api/v1/expiring" },
  { name: "activity", method: "GET", path: "/api/v1/activity?limit=50" },
  { name: "providers", method: "GET", path: "/api/v1/providers" },
  { name: "health", method: "GET", path: "/api/health" },
];
const mcpCall = (name: string) => () =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } });
const mcpRoutes: Route[] = [
  { name: "mcp summary", method: "POST", path: "/mcp", body: mcpCall("pointup_get_portfolio_summary") },
  { name: "mcp list_accounts", method: "POST", path: "/mcp", body: mcpCall("pointup_list_accounts") },
  { name: "mcp list_activity", method: "POST", path: "/mcp", body: mcpCall("pointup_list_activity") },
];

async function run(route: Route) {
  let counter = 0;
  const result = await autocannon({
    url: base,
    connections,
    duration,
    pipelining: 1,
    requests: [
      {
        method: route.method,
        path: route.path,
        setupRequest: (req: Record<string, unknown>) => {
          const token = benchToken(counter++ % users);
          const headers = {
            authorization: `Bearer ${token}`,
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          };
          return { ...req, headers, ...(route.body ? { body: route.body(token) } : {}) };
        },
      },
    ],
  });
  return result;
}

const routes = (target === "mcp" ? mcpRoutes : webRoutes).filter(
  (r) => only.length === 0 || only.includes(r.name),
);
console.log(`\nTarget ${target} ${base} | ${connections} connections | ${duration}s per route | ${users} rotating tokens\n`);
console.log("| route | RPS | p50 ms | p97.5 ms | p99 ms | max ms | non-2xx | errors |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const route of routes) {
  const r = await run(route);
  console.log(
    `| ${route.name} | ${Math.round(r.requests.average)} | ${r.latency.p50} | ${r.latency.p97_5} | ${r.latency.p99} | ${r.latency.max} | ${r.non2xx} | ${r.errors} |`,
  );
}
