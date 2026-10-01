#!/usr/bin/env node
/**
 * End-to-end smoke test for the local stack (docker compose, or the same
 * topology run natively). Needs Node >= 20 only; no dependencies.
 *
 *   npm run docker:smoke
 *
 * Env: WEB_URL (http://localhost:3000), MCP_URL (http://localhost:8787),
 * POINTUP_DEV_TOKEN (the compose default), SMOKE_WAIT_SECONDS (120).
 *
 * Flow: wait for health/readiness -> API with the dev token (summary,
 * accounts) -> token cannot do session-only things -> MCP tools/list + a tool
 * call over HTTP -> consented write-back: a write without consent is refused,
 * the consent is granted through the SESSION-only route (AUTH_PROVIDER=dev
 * makes the dev user the session; CSRF still applies, so the request carries a
 * matching Origin), the write then succeeds and the balance changes -> cleanup.
 */

const WEB = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MCP = (process.env.MCP_URL ?? "http://localhost:8787").replace(/\/$/, "");
const TOKEN =
  process.env.POINTUP_DEV_TOKEN ??
  "pu_dev_local_only_0123456789abcdef0123456789abcdef";
const WAIT_MS = Number(process.env.SMOKE_WAIT_SECONDS ?? 120) * 1000;
const bearer = { Authorization: `Bearer ${TOKEN}` };
const json = { "Content-Type": "application/json" };

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` - ${detail}` : ""}`);
  if (!ok) failures++;
}
function must(name, ok, detail) {
  check(name, ok, detail);
  if (!ok) throw new Error(`aborting: ${name}`);
}

async function waitFor(url, label) {
  const deadline = Date.now() + WAIT_MS;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return check(`${label} is up`, true);
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  must(`${label} is up`, false, last);
}

async function call(method, path, { token = false, body, origin, base = WEB } = {}) {
  const headers = { ...(body !== undefined ? json : {}), ...(token ? bearer : {}) };
  if (origin) headers.Origin = origin;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

let rpcId = 0;
async function mcp(method, params) {
  const res = await fetch(`${MCP}/mcp`, {
    method: "POST",
    headers: { ...json, Accept: "application/json, text/event-stream", ...bearer },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  const payload = text.startsWith("{")
    ? text
    : text.split("\n").find((l) => l.startsWith("data:"))?.slice(5);
  return { status: res.status, body: payload ? JSON.parse(payload) : undefined };
}

async function main() {
  console.log(`web=${WEB} mcp=${MCP}`);
  await waitFor(`${WEB}/api/health`, "web /api/health");
  await waitFor(`${WEB}/api/readyz`, "web /api/readyz (db)");
  await waitFor(`${MCP}/healthz`, "mcp /healthz");
  await waitFor(`${MCP}/readyz`, "mcp /readyz (web+db)");

  // --- API with the bootstrap token -------------------------------------
  const summary = await call("GET", "/api/v1/summary", { token: true });
  must("GET /api/v1/summary with dev token", summary.status === 200, `status ${summary.status}`);
  check("summary has seeded demo points", JSON.stringify(summary.data).length > 20);
  const accounts = await call("GET", "/api/v1/loyalty-accounts", { token: true });
  must("GET /api/v1/loyalty-accounts", accounts.status === 200, `status ${accounts.status}`);
  const list = Array.isArray(accounts.data) ? accounts.data : accounts.data?.accounts ?? [];
  check("demo portfolio seeded (>= 5 accounts)", list.length >= 5, `got ${list.length}`);
  const united = list.find((a) => (a.provider?.id ?? a.providerId) === "united");
  must("united demo account present", !!united);

  const bad = await call("GET", "/api/v1/summary", {
    token: false,
    base: WEB,
  });
  check("dev session works without any token (sign-in-free)", bad.status === 200, `status ${bad.status}`);
  const wrongToken = await fetch(`${WEB}/api/v1/summary`, {
    headers: { Authorization: "Bearer pu_definitely_not_a_real_token_0000000000" },
  });
  check("unknown pu_ token is rejected", wrongToken.status === 401, `status ${wrongToken.status}`);

  // Least privilege: the dev token has no consents:manage and is never a session.
  const tokenGrant = await call("POST", "/api/v1/consents", {
    token: true,
    body: { providerId: "united" },
  });
  check("token cannot grant consent (session-only)", tokenGrant.status === 403, `status ${tokenGrant.status}`);

  // --- MCP over HTTP ----------------------------------------------------
  const noAuth = await fetch(`${MCP}/mcp`, { method: "POST", headers: json, body: "{}" });
  check("MCP /mcp without a token is 401", noAuth.status === 401, `status ${noAuth.status}`);
  const tools = await mcp("tools/list", {});
  must("MCP tools/list with dev token", tools.status === 200, `status ${tools.status}`);
  const names = (tools.body?.result?.tools ?? []).map((t) => t.name);
  check(
    "MCP exposes the PointUp tools",
    ["pointup_get_portfolio_summary", "pointup_submit_balance"].every((n) => names.includes(n)),
    names.join(","),
  );
  const mcpSummary = await mcp("tools/call", {
    name: "pointup_get_portfolio_summary",
    arguments: {},
  });
  check(
    "MCP tool call reaches web+db with the forwarded token",
    mcpSummary.status === 200 && !mcpSummary.body?.result?.isError,
    JSON.stringify(mcpSummary.body).slice(0, 200),
  );

  // --- Consented write-back --------------------------------------------
  const skillId = "united.capture-balance";
  const sourceUrl = "https://www.united.com/en/us/myunited";
  const observe = (points) =>
    call("POST", "/api/v1/agent/observations", {
      token: true,
      body: { skillId, points, sourceUrl, agent: "docker-smoke" },
    });

  // Start from a clean slate: revoke any open united consent from a previous run.
  const existing = await call("GET", "/api/v1/consents", { token: true });
  for (const c of Array.isArray(existing.data) ? existing.data : []) {
    if (c.providerId === "united" && c.active) {
      await call("DELETE", `/api/v1/consents/${c.id}`, { origin: WEB });
    }
  }

  const before = await observe(60_000);
  check("write-back WITHOUT consent is refused", before.status === 403, `status ${before.status} ${JSON.stringify(before.data)}`);

  const csrf = await call("POST", "/api/v1/consents", {
    body: { providerId: "united" },
    origin: "https://evil.example",
  });
  check("session consent grant with a foreign Origin is rejected (CSRF)", csrf.status === 403, `status ${csrf.status}`);

  const grant = await call("POST", "/api/v1/consents", {
    body: { providerId: "united", days: 1 },
    origin: WEB,
  });
  must("grant consent via the session-only route (dev session)", grant.status === 201, `status ${grant.status} ${JSON.stringify(grant.data)}`);

  const points = 61_000 + Math.floor(Math.random() * 1000);
  const write = await observe(points);
  must("write-back WITH consent succeeds", write.status === 200, `status ${write.status} ${JSON.stringify(write.data)}`);
  check("observation outcome is recorded", write.data?.outcome === "recorded", JSON.stringify(write.data));

  const after = await call("GET", `/api/v1/loyalty-accounts/${united.id}`, { token: true });
  check(
    "balance reflects the agent's observation",
    JSON.stringify(after.data).includes(String(points)),
    `status ${after.status}`,
  );
  const audit = await call("GET", "/api/v1/agent/observations", { token: true });
  check(
    "observation is in the audit trail",
    Array.isArray(audit.data) && audit.data.some((o) => o.agent === "docker-smoke"),
  );

  // Cleanup: revoke the consent so reruns start clean.
  const grants = await call("GET", "/api/v1/consents", { token: true });
  for (const c of Array.isArray(grants.data) ? grants.data : []) {
    if (c.providerId === "united" && c.active) {
      await call("DELETE", `/api/v1/consents/${c.id}`, { origin: WEB });
    }
  }
  const revoked = await observe(points + 1);
  check("write-back after revoking consent is refused again", revoked.status === 403, `status ${revoked.status}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    failures++;
  })
  .finally(() => {
    console.log(failures === 0 ? "\nSMOKE PASSED" : `\nSMOKE FAILED (${failures} failing check(s))`);
    process.exit(failures === 0 ? 0 : 1);
  });
