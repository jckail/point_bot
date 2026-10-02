import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { RequestBodyError } from "../../../../../server/request-body";

type AssistantRunner = typeof import("../../../../../server/assistant-agent").runPortfolioAssistant;
type RouteState = {
  config: ReturnType<typeof vi.fn>;
  container: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn<AssistantRunner>>;
  actions: ReturnType<typeof vi.fn>;
  admission: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  logger: ReturnType<typeof vi.fn>;
  denial: number | undefined;
  principal: { scopes: "session" | string[]; userId: string };
  options: unknown;
};

const state = vi.hoisted((): RouteState => ({
  config: vi.fn(), container: vi.fn(), run: vi.fn<AssistantRunner>(), actions: vi.fn(),
  admission: vi.fn(), release: vi.fn(),
  denial: undefined as number | undefined,
  logger: vi.fn(), principal: { scopes: "session", userId: "private-user-id" }, options: undefined,
}));
vi.mock("@/env", () => ({ env: { OPENAI_API_KEY: "private-config-key" } }));
vi.mock("@/server/container", () => ({ getContainer: state.container }));
vi.mock("@/server/assistant-agent/config", () => ({ assistantConfig: state.config }));
vi.mock("@/server/assistant-agent/actions", () => ({ getAssistantActions: state.actions }));
vi.mock("@/server/assistant-agent", () => ({ runPortfolioAssistant: state.run }));
vi.mock("@/server/assistant-agent/admission", () => ({ assistantAdmission: { acquire: state.admission } }));
vi.mock("@/server/request-body", async () => await import("../../../../../server/request-body"));
vi.mock("@/server/observability", () => ({ webObservability: () => ({ logger: { info: state.logger } }) }));
vi.mock("@/server/access-policy", () => ({ mayWritePortfolio: (principal: { scopes: "session" | string[] }) => principal.scopes === "session" || principal.scopes.includes("portfolio:write") }));
vi.mock("@pointup/core", async (original) => ({ ...await original<object>(), getRequestContext: () => ({ requestId: "canonical-request-id" }) }));
vi.mock("@/server/http", () => ({
  withAuthenticatedUser: async (handler: (userId: string, principal: unknown) => Promise<Response>, options: unknown) => {
    state.options = options;
    let response: Response;
    if (state.denial) response = Response.json({ error: { message: "private auth diagnostic" } }, { status: state.denial });
    else {
      try { response = await handler("private-user-id", state.principal); }
      catch (error) {
        response = error instanceof RequestBodyError
          ? Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
          : Response.json({ error: { message: "Internal server error" } }, { status: 500 });
      }
    }
    response.headers.set("x-request-id", "canonical-request-id");
    return response;
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
  state.principal = { scopes: "session", userId: "private-user-id" };
  state.admission.mockReturnValue({ release: state.release });
  state.config.mockReturnValue({ runtime: "agents", tracing: false, timeoutMs: 120000 });
  state.container.mockReturnValue({ useCases: {} });
  state.actions.mockReturnValue({});
  state.run.mockResolvedValue({ reply: "private-assistant-reply", requestId: "canonical-request-id", mode: "agents", traceId: undefined });

});
afterEach(() => { vi.restoreAllMocks(); });

function observation(response: Response) {
  const calls = state.logger.mock.calls;
  expect(calls).toHaveLength(1);
  const value = calls[0]?.[1];
  expect(value.requestId).toBe(response.headers.get("X-PointUp-Request-Id"));
  expect(value.requestId).toBe("canonical-request-id");
  expect(value.requestId).not.toBe("untrusted-request-id");
  expect(value.durationMs).toEqual(expect.any(Number));
  expect(value.durationMs).toBeGreaterThanOrEqual(0);
  expect(Object.keys(value).sort()).toEqual(["component", "durationMs", "event", "httpStatus", "requestId", "surface"]);
  expect(JSON.stringify(value)).not.toMatch(/private-|untrusted-request-id/);
  return value;
}

describe("assistant HTTP support correlation", () => {
  it("rejects oversized chunked chat history before admission or portfolio services", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ message: "hello", history: Array.from({ length: 10 }, () => ({ role: "user", content: "PRIVATE_HISTORY".repeat(250) })) }));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, 20 * 1024));
      controller.enqueue(bytes.slice(20 * 1024));
      controller.close();
    } });
    const response = await POST(new Request("https://pointup.test/api/v1/assistant/chat", {
      method: "POST", headers: { "content-type": "application/json" }, body, ...{ duplex: "half" },
    }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: "REQUEST_TOO_LARGE", message: "Request body exceeds the allowed size" } });
    expect(state.admission).not.toHaveBeenCalled();
    expect(state.container).not.toHaveBeenCalled();
    expect(state.run).not.toHaveBeenCalled();
    expect(observation(response)).toMatchObject({ event: "request_failed", httpStatus: 413 });
  });
  it("retains the PR14 auth wrapper with read access and exposes proposals only with write authority", async () => {
    state.principal.scopes = ["portfolio:read"];
    await POST(request());
    expect(state.options).toEqual({ method: "POST", scope: "portfolio:read" });
    expect(state.run).toHaveBeenLastCalledWith(expect.objectContaining({ actions: undefined }));
    expect(state.actions).not.toHaveBeenCalled();
    state.principal.scopes = ["portfolio:read", "portfolio:write"];
    await POST(request());
    expect(state.actions).toHaveBeenCalledTimes(1);
    expect(state.run).toHaveBeenLastCalledWith(expect.objectContaining({ actions: {} }));
  });
  it("keeps legacy fallback independent of proposal infrastructure", async () => {
    state.config.mockReturnValueOnce({ runtime: "legacy", tracing: false, timeoutMs: 30000 });
    await POST(request());
    expect(state.actions).not.toHaveBeenCalled();
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ actions: undefined }));
  });
  it("uses independent SDK IDs and preserves the HTTP support header", async () => {
    state.config.mockReturnValueOnce({ runtime: "agents", tracing: true, timeoutMs: 30000 });
    state.run.mockImplementationOnce(async (input) => ({ reply: "ok", requestId: input.requestId ?? "canonical-request-id", mode: "agents", traceId: input.traceId }));
    const response = await POST(request());
    const traceId = state.run.mock.calls[0]?.[0].traceId;
    expect(traceId).toMatch(/^trace_[a-zA-Z0-9]{32}$/);
    expect(traceId).not.toContain("canonical-request-id");
    expect(response.headers.get("x-request-id")).toBe("canonical-request-id");
    expect(response.headers.get("X-PointUp-Request-Id")).toBe("canonical-request-id");
    expect(response.headers.get("X-PointUp-Trace-Id")).toBe(traceId);
  });
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
    state.logger.mockImplementationOnce(() => { throw new Error("logging unavailable"); });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reply: "private-assistant-reply" });
    expect(response.headers.get("X-PointUp-Request-Id")).toBe("canonical-request-id");
  });
});
