import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: vi.fn(), container: vi.fn(), run: vi.fn(), actions: vi.fn(),
  admission: vi.fn(), release: vi.fn(),
  denial: undefined as number | undefined,
}));
vi.mock("@/env", () => ({ env: { OPENAI_API_KEY: "private-config-key" } }));
vi.mock("@/server/container", () => ({ getContainer: state.container }));
vi.mock("@/server/assistant-agent/config", () => ({ assistantConfig: state.config }));
vi.mock("@/server/assistant-agent/actions", () => ({ getAssistantActions: state.actions }));
vi.mock("@/server/assistant-agent", () => ({ runPortfolioAssistant: state.run }));
vi.mock("@/server/assistant-agent/admission", () => ({ assistantAdmission: { acquire: state.admission } }));
vi.mock("@/server/http", () => ({
  readJsonBody: (request: Request) => request.json(),
  withAuthenticatedUser: async (handler: (userId: string, principal: unknown) => Promise<Response>) => {
    if (state.denial) return Response.json({ error: { message: "private auth diagnostic" } }, { status: state.denial });
    try { return await handler("private-user-id", { kind: "session" }); }
    catch { return Response.json({ error: { message: "Internal server error" } }, { status: 500 }); }
  },
}));

import { POST } from "./route";

function request(surface = "web") {
  return new Request("https://pointup.test/api/v1/assistant/chat", {
    method: "POST", headers: { "Content-Type": "application/json", "X-PointUp-Surface": surface, "X-PointUp-Request-Id": "untrusted-request-id" },
    body: JSON.stringify({ message: "private-chat-message", history: [{ role: "user", content: "private-chat-history" }] }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.denial = undefined;
  state.admission.mockReturnValue({ release: state.release });
  state.config.mockReturnValue({ runtime: "agents", tracing: false, timeoutMs: 120000 });
  state.container.mockReturnValue({ useCases: {} });
  state.actions.mockReturnValue({});
  state.run.mockResolvedValue({ reply: "private-assistant-reply" });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

function observation(response: Response) {
  const calls = vi.mocked(console.info).mock.calls;
  expect(calls).toHaveLength(1);
  const value = JSON.parse(String(calls[0]?.[0]));
  expect(value.requestId).toBe(response.headers.get("X-PointUp-Request-Id"));
  expect(value.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(value.requestId).not.toBe("untrusted-request-id");
  expect(value.durationMs).toEqual(expect.any(Number));
  expect(value.durationMs).toBeGreaterThanOrEqual(0);
  expect(Object.keys(value).sort()).toEqual(["component", "durationMs", "event", "httpStatus", "requestId", "surface"]);
  expect(JSON.stringify(value)).not.toMatch(/private-|untrusted-request-id/);
  return value;
}

describe("assistant HTTP support correlation", () => {
  it("rejects saturation before loading runtime dependencies and correlates the private 429", async () => {
    state.admission.mockReturnValueOnce({ retryAfter: 17 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: { code: "RATE_LIMITED", message: "Assistant request limit reached. Try again shortly." } });
    expect(observation(response)).toMatchObject({ event: "request_failed", httpStatus: 429 });
    expect(state.admission).toHaveBeenCalledWith("private-user-id");
    expect(state.config).not.toHaveBeenCalled();
    expect(state.container).not.toHaveBeenCalled();
    expect(state.actions).not.toHaveBeenCalled();
    expect(state.run).not.toHaveBeenCalled();
    expect(state.release).not.toHaveBeenCalled();
  });
  it.each(["config", "container", "actions", "run"] as const)("releases admission after %s failure", async kind => {
    state[kind].mockImplementationOnce(() => { throw new Error("private failure"); });
    expect((await POST(request())).status).toBe(500);
    expect(state.release).toHaveBeenCalledTimes(1);
  });
  it("releases admission on cancelled runtime requests", async () => {
    state.run.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    expect((await POST(request())).status).toBe(500);
    expect(state.release).toHaveBeenCalledTimes(1);
  });
  it("correlates successful extension requests without logging content or credentials", async () => {
    const response = await POST(request("extension"));
    expect(response.status).toBe(200);
    expect(state.release).toHaveBeenCalledTimes(1);
    expect(observation(response)).toMatchObject({ component: "pointup_assistant_http", event: "request_completed", httpStatus: 200, surface: "extension" });
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ source: "extension", requestId: response.headers.get("X-PointUp-Request-Id"), config: expect.objectContaining({ timeoutMs: 20000 }) }));
  });
  it("preserves configured web deadlines and never increases a shorter extension deadline", async () => {
    await POST(request("web"));
    expect(state.run).toHaveBeenLastCalledWith(expect.objectContaining({ config: expect.objectContaining({ timeoutMs: 120000 }) }));
    await POST(request("api"));
    expect(state.run).toHaveBeenLastCalledWith(expect.objectContaining({ config: expect.objectContaining({ timeoutMs: 120000 }) }));
    state.config.mockReturnValueOnce({ runtime: "agents", tracing: false, timeoutMs: 10000 });
    await POST(request("extension"));
    expect(state.run).toHaveBeenLastCalledWith(expect.objectContaining({ config: expect.objectContaining({ timeoutMs: 10000 }) }));
  });
  it.each(["config", "container"] as const)("correlates a pre-runtime %s failure returned by the auth wrapper", async kind => {
    state[kind].mockImplementationOnce(() => { throw new Error("private setup diagnostic"); });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(observation(response)).toMatchObject({ component: "pointup_assistant_http", event: "request_failed", httpStatus: 500, surface: "web" });
    expect(state.run).not.toHaveBeenCalled();
  });
  it("correlates denied admission and bounds unknown surfaces before runtime starts", async () => {
    state.denial = 403;
    const response = await POST(request("private-arbitrary-surface"));
    expect(response.status).toBe(403);
    expect(observation(response)).toMatchObject({ component: "pointup_assistant_http", event: "request_failed", httpStatus: 403, surface: "api" });
    expect(state.config).not.toHaveBeenCalled();
    expect(state.run).not.toHaveBeenCalled();
  });
  it("keeps the HTTP response usable when telemetry fails", async () => {
    vi.mocked(console.info).mockImplementationOnce(() => { throw new Error("logging unavailable"); });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reply: "private-assistant-reply" });
    expect(response.headers.get("X-PointUp-Request-Id")).toMatch(/^[a-f0-9-]{36}$/);
  });
});
