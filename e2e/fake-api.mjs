// Tiny deterministic stand-in for the PointUp HTTP API (only what the smoke
// test touches). Records every request at GET /__calls.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_API_PORT ?? 4010);
const calls = [];

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__health") return res.writeHead(200).end("ok");
  if (url.pathname === "/__calls") return json(res, 200, calls);

  let body = "";
  for await (const chunk of req) body += chunk;
  calls.push({
    method: req.method,
    path: url.pathname + url.search,
    auth: req.headers.authorization,
    body: body ? JSON.parse(body) : undefined,
  });

  if (req.headers.authorization !== "Bearer pu_e2e") {
    return json(res, 401, { error: { code: "ACCESS_TOKEN_INVALID", message: "bad token" } });
  }
  if (req.method === "GET" && url.pathname === "/api/v1/summary") {
    return json(res, 200, {
      totalPoints: 12345,
      totalValueCents: 24690,
      accountCount: 2,
      byKind: {
        airline: { accounts: 2, points: 12345, valueCents: 24690 },
        hotel: { accounts: 0, points: 0, valueCents: 0 },
        credit_card: { accounts: 0, points: 0, valueCents: 0 },
        rail: { accounts: 0, points: 0, valueCents: 0 },
        shopping: { accounts: 0, points: 0, valueCents: 0 },
      },
      lastSyncedAt: null,
    });
  }
  if (req.method === "POST" && url.pathname === "/api/v1/agent/observations") {
    return json(res, 403, {
      error: { code: "CONSENT_REQUIRED", message: "No active consent for united" },
    });
  }
  return json(res, 404, { error: { code: "NOT_FOUND", message: url.pathname } });
}).listen(port, "127.0.0.1");
