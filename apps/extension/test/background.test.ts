import { PointUpApiError } from "@pointup/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  capture: null as Record<string, unknown> | null,
  list: vi.fn(), record: vi.fn(), execute: vi.fn(), query: vi.fn(), ask: vi.fn(), observe: vi.fn(), tabGet: vi.fn(), tabUpdate: vi.fn(), tabCreate: vi.fn(),
  store: {} as Record<string, unknown>,
  options: {} as { fetch?: typeof fetch; headers?: Record<string, string>; timeoutMs?: number },
  config: { baseUrl: "https://pointup.test", token: "pu_test" },
  chat: [] as { role: string; content: string }[],
}));
vi.mock("../src/config", () => ({
  loadConfig: async () => ({ ...state.config }),
  loadLatestCapture: async () => state.capture,
  saveLatestCapture: async (capture: Record<string, unknown> | null) => { state.capture = capture; delete state.store.pendingObservation; },
}));
vi.mock("@pointup/api-client", () => ({
  PointUpApiError: class extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } },
  PointUpClient: class { constructor(options: { fetch?: typeof fetch }) { state.options = options; } listLoyaltyAccounts = state.list; recordManualBalance = state.record; chatWithAssistant = state.ask; submitAgentObservation = state.observe; },
}));
let listener: (message: unknown, sender: unknown, response: (value: unknown) => void) => unknown;
const sender = { id: "trusted", url: "chrome-extension://trusted/popup.html" };
async function send(message: unknown): Promise<{ ok: boolean; message: string }> {
  const result = await new Promise<{ ok: boolean; message: string }>(resolve => listener(message, sender, value => resolve(value as { ok: boolean; message: string })));
  await Promise.resolve(); return result;
}
function capture() {
  return { id: "capture-id", sourceOrigin: "https://united.com", providerId: "united", points: 100, capturedAt: Date.now(), sourceMethod: "page_capture" };
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); state.capture = capture(); state.config = { baseUrl: "https://pointup.test", token: "pu_test" };
  state.list.mockResolvedValue([{ id: "one", provider: { id: "united", displayName: "United" }, membershipNumber: "1234" },
    { id: "two", provider: { id: "united", displayName: "United" }, membershipNumber: "5678" }]);
  state.store = {}; state.tabGet.mockResolvedValue({ id: 10 }); state.tabUpdate.mockResolvedValue({ id: 10 }); state.tabCreate.mockResolvedValue({ id: 10 });
  state.observe.mockResolvedValue({ id: "capture-id", status: "accepted" }); state.record.mockResolvedValue({}); state.ask.mockResolvedValue({ reply: "Here is portfolio advice." }); state.chat = [];
  vi.stubGlobal("chrome", { runtime: { id: "trusted", getURL: () => sender.url,
    onMessage: { addListener: (handler: typeof listener) => { listener = handler; } } },
    storage: { session: {
      get: async () => ({ ...state.store, assistantChat: state.chat }),
      set: async (value: Record<string, unknown>) => {
        Object.assign(state.store, value);
        if ("assistantChat" in value) state.chat = value.assistantChat as typeof state.chat;
        if ("latestCapture" in value) state.capture = value.latestCapture as typeof state.capture;
      },
      remove: async (key: string) => { delete state.store[key]; if (key === "assistantChat") state.chat = []; },
    } },
    permissions: { contains: async () => true }, tabs: { query: state.query, get: state.tabGet, update: state.tabUpdate, create: state.tabCreate }, scripting: { executeScript: state.execute } });
  await import("../src/background");
});

describe("background consent and review pipeline", () => {
  it("ignores messages from provider tabs", () => {
    const reply = vi.fn();
    listener({ type: "record" }, { ...sender, tab: { id: 1 }, url: "https://united.com" }, reply);
    expect(reply).not.toHaveBeenCalled(); expect(state.list).not.toHaveBeenCalled();
  });
  it("never reads unsupported pages and clears the previous review", async () => {
    state.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
    expect((await send({ type: "captureActive" })).ok).toBe(false);
    expect(state.execute).not.toHaveBeenCalled(); expect(state.capture).toBeNull();
  });
  it("rejects navigation to a different origin during capture", async () => {
    state.query.mockResolvedValue([{ id: 1, url: "https://united.com/account" }]);
    state.execute.mockResolvedValue([{ result: { url: "https://delta.com/account", text: "Balance 100 miles" } }]);
    expect((await send({ type: "captureActive" })).ok).toBe(false);
    expect(state.capture).toBeNull();
  });
  it("stores only the reviewed balance and source origin", async () => {
    state.query.mockResolvedValue([{ id: 1, url: "https://united.com/account?private=yes" }]);
    state.execute.mockResolvedValue([{ result: { url: "https://united.com/account?private=yes", text: "Balance 100 miles" } }]);
    expect((await send({ type: "captureActive" })).ok).toBe(true);
    expect(state.capture).toMatchObject({ providerId: "united", points: 100, sourceOrigin: "https://united.com" });
    expect(state.capture).not.toHaveProperty("text"); expect(state.capture).not.toHaveProperty("url");
    expect(state.record).not.toHaveBeenCalled();
  });
  it("requires the exact reviewed capture and selected account", async () => {
    expect((await send({ type: "record", captureId: "old", accountId: "two", points: 100 })).ok).toBe(false);
    expect((await send({ type: "record", captureId: "capture-id", accountId: "unknown", points: 100 })).ok).toBe(false);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("writes edited points to the explicitly selected matching account", async () => {
    const result = await send({ type: "record", captureId: "capture-id", accountId: "two", points: 150 });
    expect(result.ok).toBe(true); expect(state.observe).toHaveBeenCalledWith(expect.objectContaining({ observationId: "capture-id", accountId: "two", providerId: "united", points: 150, sourceUrl: "https://united.com", sourceMethod: "page_capture" }));
    expect(state.record).not.toHaveBeenCalled();
    expect(state.capture).toBeNull();
  });
  it("preserves review on failed writes", async () => {
    state.observe.mockRejectedValueOnce(new Error("Network unavailable"));
    expect((await send({ type: "record", captureId: "capture-id", accountId: "one", points: 100 })).ok).toBe(false);
    expect(state.capture?.id).toBe("capture-id");
  });
});

describe("extension assistant", () => {
  it("labels assistant calls and bounds the client below the Chrome worker fetch limit", async () => {
    expect((await send({ type: "ask", message: "Help" })).ok).toBe(true);
    expect(state.options).toMatchObject({ timeoutMs: 25000, headers: { "X-PointUp-Surface": "extension", Authorization: "Bearer pu_test" } });
    expect((await send({ type: "getAccounts" })).ok).toBe(true);
    expect(state.options.timeoutMs).toBe(30000);
    expect(state.options.headers).not.toHaveProperty("X-PointUp-Surface");
  });
  it("shows the support reference on failed assistant responses without exposing provider error text", async () => {
    state.chat = [{ role: "user", content: "Previous question" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503, headers: { "X-PointUp-Request-Id": "request-failed" } })));
    state.ask.mockImplementationOnce(async () => {
      await state.options.fetch?.("https://pointup.test/api/v1/assistant/chat", { method: "POST" });
      throw new PointUpApiError(503, "ASSISTANT_UNAVAILABLE", "private upstream diagnostic");
    });
    const result = await send({ type: "ask", message: "Help" });
    expect(result).toEqual({ ok: false, message: "API request failed (503). Try again. Support reference: request-failed" });
    expect(result.message).not.toContain("private upstream");
    expect(state.chat).toEqual([{ role: "user", content: "Previous question" }]);
  });
  it("rejects unsafe support references and explains a client deadline without saving failed chat", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503, headers: { "X-PointUp-Request-Id": "private value /?token=secret" } })));
    state.ask.mockImplementationOnce(async () => {
      await state.options.fetch?.("https://pointup.test/api/v1/assistant/chat", { method: "POST" });
      throw new PointUpApiError(503, "ASSISTANT_UNAVAILABLE", "private diagnostic");
    });
    expect((await send({ type: "ask", message: "Help" })).message).toBe("API request failed (503). Try again.");
    state.ask.mockRejectedValueOnce(new DOMException("native abort detail", "TimeoutError"));
    expect((await send({ type: "ask", message: "Help" })).message).toBe("The request took too long to respond. Try again.");
    expect(state.chat).toEqual([]);
  });
  it("routes user input and bounded conversation without provider page text or capture data", async () => {
    state.chat = [{ role: "user", content: "Earlier question" }, { role: "assistant", content: "Earlier reply" }];
    expect((await send({ type: "ask", message: "  What should I do with my points?  " })).ok).toBe(true);
    expect(state.ask).toHaveBeenCalledWith({ message: "What should I do with my points?", history: [
      { role: "user", content: "Earlier question" }, { role: "assistant", content: "Earlier reply" },
    ] });
    expect(state.execute).not.toHaveBeenCalled(); expect(state.query).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled(); expect(state.capture?.id).toBe("capture-id");
    expect(state.chat).toHaveLength(4);
  });
  it("retains bounded request and trace metadata for support", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { headers: {
      "X-PointUp-Request-Id": "request-id", "X-PointUp-Assistant-Mode": "agents", "X-PointUp-Trace-Id": "trace-id",
    } })));
    state.ask.mockImplementationOnce(async () => {
      await state.options.fetch?.("https://pointup.test/api/v1/assistant/chat", { method: "POST" });
      return { reply: "Advice" };
    });
    expect((await send({ type: "ask", message: "Help" })).ok).toBe(true);
    expect(state.chat.at(-1)).toMatchObject({ requestId: "request-id", mode: "agents", traceId: "trace-id" });
    expect(fetch).toHaveBeenCalledWith("https://pointup.test/api/v1/assistant/chat", { method: "POST", redirect: "error", credentials: "omit" });
  });
  it("does not save replies across an API account change", async () => {
    state.ask.mockImplementationOnce(async () => {
      state.config = { baseUrl: "https://pointup.test", token: "different-user" };
      return { reply: "Old account advice" };
    });
    expect((await send({ type: "ask", message: "Help" })).ok).toBe(false);
    expect(state.chat).toEqual([]);
  });
  it("rejects empty and oversized questions before contacting the API", async () => {
    expect((await send({ type: "ask", message: "  " })).ok).toBe(false);
    expect((await send({ type: "ask", message: "a".repeat(4001) })).ok).toBe(false);
    expect(state.ask).not.toHaveBeenCalled();
  });
  it("bounds transcript storage and preserves conversation on API failure", async () => {
    state.chat = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Message ${i}` }));
    expect((await send({ type: "ask", message: "next" })).ok).toBe(true);
    expect(state.chat).toHaveLength(16);
    state.ask.mockRejectedValueOnce(new Error("Offline"));
    const previous = [...state.chat];
    expect((await send({ type: "ask", message: "retry" })).ok).toBe(false);
    expect(state.chat).toEqual(previous);
  });
  it("clears session conversation without touching the reviewed capture", async () => {
    state.chat = [{ role: "user", content: "private question" }];
    expect((await send({ type: "clearChat" })).ok).toBe(true);
    expect(state.chat).toEqual([]); expect(state.capture?.id).toBe("capture-id");
  });
});

describe("guided collection and consent-bound observations", () => {
  it("creates one owned provider tab and reuses it for later explicit navigation", async () => {
    expect((await send({ type: "openProvider", providerId: "bilt" })).ok).toBe(true);
    expect(state.tabCreate).toHaveBeenCalledWith({ url: "https://www.bilt.com/", active: true });
    expect((await send({ type: "openProvider", providerId: "amtrak" })).ok).toBe(true);
    expect(state.tabUpdate).toHaveBeenCalledWith(10, { url: "https://www.amtrak.com/guestrewards/account-overview.html", active: true });
    expect(state.tabCreate).toHaveBeenCalledTimes(1); expect(state.query).not.toHaveBeenCalled();
    expect(state.execute).not.toHaveBeenCalled();
  });
  it("opens browser-session approval settings without approval API calls", async () => {
    expect((await send({ type: "openPointUp" })).ok).toBe(true);
    expect(state.tabCreate).toHaveBeenCalledWith({ url: "https://pointup.test/dashboard/settings", active: true });
    expect(state.observe).not.toHaveBeenCalled(); expect(state.record).not.toHaveBeenCalled();
  });
  it("stages manual points without claiming that page text was read", async () => {
    expect((await send({ type: "manualBalance", providerId: "bilt", points: 4500, unit: "points" })).ok).toBe(true);
    expect(state.capture).toMatchObject({ providerId: "bilt", points: 4500, sourceMethod: "manual_entry", sourceUrl: "https://www.bilt.com/" });
    expect(state.execute).not.toHaveBeenCalled(); expect(state.observe).not.toHaveBeenCalled();
  });
  it("does not read unverified reader programs or stage cash/Rakuten amounts", async () => {
    state.query.mockResolvedValue([{ id: 1, url: "https://www.bilt.com/account" }]);
    expect((await send({ type: "captureActive", providerId: "bilt" })).ok).toBe(false);
    expect((await send({ type: "manualBalance", providerId: "bilt", points: 100, unit: "usd" })).ok).toBe(false);
    expect((await send({ type: "manualBalance", providerId: "rakuten", points: 100, unit: "points" })).ok).toBe(false);
    expect(state.execute).not.toHaveBeenCalled(); expect(state.capture).toBeNull();
  });
  it("retries lost responses with exactly the same review UUID and payload", async () => {
    state.observe.mockRejectedValueOnce(new Error("Response lost"));
    const message = { type: "record", captureId: "capture-id", accountId: "one", points: 150 };
    expect((await send(message)).ok).toBe(false);
    const payload = state.observe.mock.calls[0]?.[0];
    expect(state.capture).toMatchObject({ id: "capture-id", points: 150, lockedAccountId: "one" });
    expect((await send({ ...message, points: 151 })).ok).toBe(false);
    expect(state.observe).toHaveBeenCalledTimes(1);
    expect((await send(message)).ok).toBe(true);
    expect(state.observe.mock.calls[1]?.[0]).toEqual(payload);
    expect(state.capture).toBeNull();
  });
  it("preserves rejected consent reviews and reports held anomalies separately", async () => {
    state.observe.mockRejectedValueOnce(new PointUpApiError(403, "CONSENT_REQUIRED", "private backend details"));
    const message = { type: "record", captureId: "capture-id", accountId: "one", points: 150 };
    const rejected = await send(message);
    expect(rejected.ok).toBe(false); expect(rejected.message).toContain("consent");
    expect(rejected.message).not.toContain("private backend details"); expect(state.capture?.id).toBe("capture-id");
    state.observe.mockResolvedValueOnce({ status: "held" });
    const held = await send(message); expect(held.ok).toBe(true); expect(held.message).toContain("held");
    expect(held.message).toContain("not changed"); expect(state.capture).toBeNull();
  });
  it("never falls back to a raw balance write for temporary session tokens", async () => {
    state.config.token = "clerk-session";
    const result = await send({ type: "record", captureId: "capture-id", accountId: "one", points: 100 });
    expect(result.ok).toBe(false); expect(result.message).toContain("personal access token");
    expect(state.observe).not.toHaveBeenCalled(); expect(state.record).not.toHaveBeenCalled();
  });
  it("stores proposal review summaries while never approving actions", async () => {
    const action = { id: "proposal", kind: "manual_balance", status: "pending", title: "Update balance", summary: "Review 150 points", expiresAt: new Date(Date.now() + 60000).toISOString() };
    state.ask.mockResolvedValueOnce({ reply: "Review this proposed change.", actions: [action] });
    expect((await send({ type: "ask", message: "Update my points" })).ok).toBe(true);
    expect(state.chat.at(-1)).toMatchObject({ actions: [action] });
    expect(state.observe).not.toHaveBeenCalled(); expect(state.record).not.toHaveBeenCalled();
  });
});
