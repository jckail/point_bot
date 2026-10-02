import { expect, test, type APIRequestContext } from "@playwright/test";

const API = "http://127.0.0.1:4010";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

let id = 0;
/** One JSON-RPC call; the stateless server replies as JSON or a single SSE event. */
async function rpc(
  request: APIRequestContext,
  method: string,
  params: unknown,
  token = "pu_e2e",
) {
  const response = await request.post("/mcp", {
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    data: { jsonrpc: "2.0", id: ++id, method, params },
  });
  expect(response.status()).toBe(200);
  const text = await response.text();
  const data = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .find((line) => line.startsWith("data:"))!
        .slice(5);
  return JSON.parse(data) as {
    result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean };
    error?: unknown;
  };
}

test("healthz is open, /mcp requires a pu_ bearer token", async ({ request }) => {
  expect((await request.get("/healthz")).status()).toBe(200);
  const noToken = await request.post("/mcp", { headers: HEADERS, data: {} });
  expect(noToken.status()).toBe(401);
  const wrongPrefix = await request.post("/mcp", {
    headers: { ...HEADERS, Authorization: "Bearer sk_nope" },
    data: {},
  });
  expect(wrongPrefix.status()).toBe(401);
  expect((await request.get("/nope")).status()).toBe(404);
});

test("lists the agent tools", async ({ request }) => {
  const { result } = await rpc(request, "tools/list", {});
  const names = result!.tools!.map((tool) => tool.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "pointup_get_portfolio_summary",
      "pointup_request_consent",
      "pointup_submit_balance",
    ]),
  );
});

test("a read tool forwards the caller's own token to the API", async ({ request }) => {
  const { result } = await rpc(request, "tools/call", {
    name: "pointup_get_portfolio_summary",
    arguments: {},
  });
  expect(result!.isError, result!.content?.[0]?.text).toBeFalsy();
  expect(JSON.parse(result!.content![0]!.text)).toMatchObject({ totalPoints: 12345 });

  const calls = (await (await request.get(`${API}/__calls`)).json()) as {
    path: string;
    auth: string;
  }[];
  expect(calls.at(-1)).toMatchObject({
    path: "/api/v1/summary",
    auth: "Bearer pu_e2e",
  });
});

test("API errors surface as tool errors, not protocol errors", async ({ request }) => {
  const { result, error } = await rpc(request, "tools/call", {
    name: "pointup_submit_balance",
    arguments: {
      skillId: "united.capture-balance",
      points: 100,
      sourceUrl: "https://www.united.com/en/us/myunited",
    },
  });
  expect(error).toBeUndefined();
  expect(result!.isError).toBe(true);
  expect(result!.content![0]!.text).toContain("CONSENT_REQUIRED");
});

test("without elicitation support, consent is deferred to the dashboard", async ({
  request,
}) => {
  const { result } = await rpc(request, "tools/call", {
    name: "pointup_request_consent",
    arguments: { providerId: "united" },
  });
  const payload = JSON.parse(result!.content![0]!.text);
  expect(payload.granted).toBe(false);
  expect(payload.action).toContain("/dashboard/agents");
});

test("a token the API rejects yields a tool error", async ({ request }) => {
  const { result } = await rpc(
    request,
    "tools/call",
    { name: "pointup_get_portfolio_summary", arguments: {} },
    "pu_wrong",
  );
  expect(result!.isError).toBe(true);
  expect(result!.content![0]!.text).toContain("UNAUTHENTICATED");
  expect(result!.content![0]!.text).toContain("Provide a valid PointUp access token");
  expect(result!.content![0]!.text).not.toContain("bad token");
});

test("rejects a foreign Host header (DNS rebinding) but healthz stays open", async ({ request }) => {
  const rebound = await request.get("/.well-known/oauth-protected-resource", {
    headers: { Host: "evil.example" },
  });
  expect(rebound.status()).toBe(403);
  const health = await request.get("/healthz", { headers: { Host: "evil.example" } });
  expect(health.status()).toBe(200);
});

test("rejects a disallowed browser Origin, accepts the allow-listed one", async ({ request }) => {
  const call = (origin: string) =>
    request.post("/mcp", {
      headers: { ...HEADERS, Origin: origin, Authorization: "Bearer pu_e2e" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
  expect((await call("https://evil.example")).status()).toBe(403);
  expect((await call("https://claude.ai")).status()).toBe(200);
});

test("malformed JSON is a 400 parse error, not a 500", async ({ request }) => {
  const response = await request.post("/mcp", {
    headers: { ...HEADERS, Authorization: "Bearer pu_e2e" },
    data: "{not json",
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: -32700 } });
});
