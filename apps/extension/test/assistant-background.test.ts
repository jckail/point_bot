import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ask: vi.fn(), clear: vi.fn(), load: vi.fn(), review: vi.fn() }));
vi.mock("../src/assistant", () => ({ askAssistant: mocks.ask, clearChat: mocks.clear, loadChat: mocks.load, openReviewTab: mocks.review }));
vi.mock("../src/record", () => ({ recordCapture: vi.fn() }));
let listener: (message: unknown, sender: unknown, respond: (result: unknown) => void) => unknown;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubGlobal("chrome", { runtime: { id: "extension_id", getURL: () => "chrome-extension://extension_id/popup.html", onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
  await import("../src/background");
});
const popup = { id: "extension_id", url: "chrome-extension://extension_id/popup.html" };
it("does not let provider/content scripts access or send conversations", () => {
  const respond = vi.fn();
  listener({ type: "ask", message: "private" }, { ...popup, tab: { id: 4 } }, respond);
  listener({ type: "getChat" }, { id: "other", url: popup.url }, respond);
  listener({ type: "clearChat" }, { id: popup.id, url: "https://provider.example" }, respond);
  expect(mocks.ask).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled(); expect(respond).not.toHaveBeenCalled();
});
it("serializes chat mutation while a request is pending", async () => {
  let finish!: (value: unknown) => void;
  mocks.ask.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const respond = vi.fn();
  expect(listener({ type: "ask", message: "My trip" }, popup, respond)).toBe(true);
  listener({ type: "clearChat" }, popup, respond);
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(respond).toHaveBeenCalledWith({ ok: false, message: "The assistant is working. Please wait." });
  finish({ ok: true, message: "", chat: [] });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(respond).toHaveBeenCalledWith({ ok: true, message: "", chat: [] });
});
