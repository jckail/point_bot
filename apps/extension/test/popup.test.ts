import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatResult, ExtensionMessage } from "../src/messages";

const mocks = vi.hoisted(() => ({ save: vi.fn(), render: vi.fn() }));
vi.mock("../src/config", () => ({ loadConfig: async () => ({ baseUrl: "https://pointup.example", token: "pu_original" }), saveConfig: mocks.save }));
vi.mock("../src/chat-view", () => ({ renderChat: mocks.render }));

class Element {
  textContent = "";
  value = "";
  disabled = false;
  listeners: Record<string, () => void> = {};
  addEventListener(type: string, listener: () => void) { this.listeners[type] = listener; }
  querySelectorAll() { return [elements.ask!, elements.clearChat!]; }
}
const elements: Record<string, Element> = {};
const capture = { captureId: "00000000-0000-4000-8000-000000000001", providerId: "united", points: 123,
  observedAt: "2026-10-02T01:00:00.000Z", sourceMethod: "page_capture", retryLocked: true,
  receipt: { ok: false, outcome: "rejected", message: "Observation rejected. Check PointUp before creating another capture.", observationId: "receipt_123", reviewId: null } };
const send = vi.fn(async (message: ExtensionMessage): Promise<unknown> => message.type === "getLatest" ? capture : { ok: true, message: "", chat: [] });
async function flush() { await new Promise(resolve => setTimeout(resolve, 0)); }
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  for (const id of ["latest", "record", "discardCapture", "openObservationReview", "baseUrl", "token", "save", "status", "assistant", "askForm", "question", "chat", "chatStatus", "ask", "clearChat"]) elements[id] = new Element();
  mocks.save.mockResolvedValue(undefined);
  send.mockImplementation(async message => message.type === "getLatest" ? capture : { ok: true, message: "", chat: [] });
  vi.stubGlobal("document", { getElementById: (id: string) => elements[id] });
  vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  await import("../src/popup");
  await flush();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("restores persisted rejection guidance and receipt reference on reopening", () => {
  expect(elements.status!.textContent).toContain("Outcome: rejected");
  expect(elements.status!.textContent).toContain("Check PointUp");
  expect(elements.status!.textContent).toContain("Observation: receipt_123");
});
it("shows completed receipt on reopening even after the capture cleared, without recording again", async () => {
  send.mockImplementation(async message => message.type === "getLatest" ? null : message.type === "getCaptureReceipt"
    ? { ok: true, outcome: "recorded", message: "Recorded", observationId: "receipt_complete" } : { ok: true, message: "", chat: [] });
  vi.resetModules(); await import("../src/popup"); await flush();
  expect(elements.status!.textContent).toContain("Last completed capture: Outcome: recorded");
  expect(elements.status!.textContent).toContain("Observation: receipt_complete");
  expect(elements.record!.disabled).toBe(true);
  expect(send.mock.calls.some(([message]) => message.type === "record")).toBe(false);
});
it("saves a pasted page URL as canonical origin and reports unsafe URLs clearly", async () => {
  elements.baseUrl!.value = "https://pointup.example/dashboard";
  elements.save!.listeners.click!(); await flush();
  expect(mocks.save).toHaveBeenCalledWith({ baseUrl: "https://pointup.example", token: "pu_original" });
  expect(elements.baseUrl!.value).toBe("https://pointup.example");
  mocks.save.mockClear(); elements.baseUrl!.value = "https://user:password@pointup.example";
  elements.save!.listeners.click!(); await flush();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(elements.status!.textContent).toContain("without credentials");
  expect(elements.status!.textContent).not.toContain("password@");
});

it("binds popup discard to the displayed capture", async () => {
  elements.discardCapture!.listeners.click!();
  await flush();
  expect(send).toHaveBeenCalledWith({ type: "discardCapture", captureId: capture.captureId });
});

it("prevents repeated recording while pending and recovers controls after worker failure", async () => {
  let reject!: (error: Error) => void;
  send.mockImplementation(async message => message.type === "record" ? new Promise((_resolve, fail) => { reject = fail; }) : capture);
  elements.record!.listeners.click!();
  elements.record!.listeners.click!();
  expect(send.mock.calls.filter(([message]) => message.type === "record")).toHaveLength(1);
  expect(elements.record!.disabled).toBe(true);
  expect(elements.discardCapture!.disabled).toBe(true);
  expect(elements.save!.disabled).toBe(true);
  reject(new Error("Worker stopped"));
  await flush();
  expect(elements.status!.textContent).toContain("worker unavailable");
  expect(elements.status!.textContent).not.toContain("Recording…");
  expect(elements.record!.disabled).toBe(false);
  expect(elements.save!.disabled).toBe(false);
});

it("reports failed settings persistence without claiming it saved", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Storage unavailable"));
  elements.save!.listeners.click!();
  expect(elements.save!.disabled).toBe(true);
  await flush();
  expect(elements.status!.textContent).toContain("could not be saved");
  expect(send).not.toHaveBeenCalledWith({ type: "clearChat" });
  expect(elements.save!.disabled).toBe(false);
});

it("distinguishes saved settings from a busy conversation-clear failure", async () => {
  send.mockImplementation(async () => ({ ok: false, message: "The assistant is working. Please wait." }));
  elements.save!.listeners.click!();
  await flush();
  expect(mocks.save).toHaveBeenCalledWith({ baseUrl: "https://pointup.example", token: "pu_original" });
  expect(elements.status!.textContent).toContain("Settings saved. Conversation could not be cleared");
  expect(elements.save!.disabled).toBe(false);
});

it("reopens an in-flight question and automatically refreshes its eventual answer", async () => {
  vi.useFakeTimers();
  let current: ChatResult = { ok: true, message: "", chat: [], pending: { question: "Saved question", status: "in_flight", message: "The assistant is working. Your question is saved." } };
  send.mockImplementation(async message => message.type === "getLatest" ? capture : current);
  vi.resetModules();
  await import("../src/popup");
  await vi.advanceTimersByTimeAsync(0);
  expect(elements.question!.value).toBe("Saved question");
  expect(elements.ask!.disabled).toBe(true);
  expect(elements.chatStatus!.textContent).toContain("working");
  current = { ...current, pending: { question: "Saved question", status: "in_flight", message: "Still working; question remains saved." } };
  await vi.advanceTimersByTimeAsync(1000);
  expect(elements.chatStatus!.textContent).toContain("Still working");
  expect(elements.ask!.disabled).toBe(true);
  current = { ok: true, message: "", chat: [{ role: "user", content: "Saved question" }, { role: "assistant", content: "Recovered answer" }] };
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.render).toHaveBeenLastCalledWith(elements.chat, current.chat, expect.any(Function));
  expect(elements.question!.value).toBe("");
  expect(elements.ask!.disabled).toBe(false);
  expect(elements.chatStatus!.textContent).toBe("");
  const count = send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(send).toHaveBeenCalledTimes(count);
  expect(send.mock.calls.some(([message]) => message.type === "ask")).toBe(false);
});

it("restores an uncertain question for explicit retry without polling or resubmission", async () => {
  vi.useFakeTimers();
  const current: ChatResult = { ok: true, message: "", chat: [], pending: { question: "Interrupted question", status: "uncertain", message: "Outcome unknown. Check proposed actions before explicitly retrying." } };
  send.mockImplementation(async message => message.type === "getLatest" ? capture : current);
  vi.resetModules();
  await import("../src/popup");
  await vi.advanceTimersByTimeAsync(0);
  expect(elements.question!.value).toBe("Interrupted question");
  expect(elements.ask!.disabled).toBe(false);
  expect(elements.chatStatus!.textContent).toContain("Check proposed actions");
  const count = send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(send).toHaveBeenCalledTimes(count);
  expect(send.mock.calls.some(([message]) => message.type === "ask")).toBe(false);
});

it("clears the pending display when a scoped read returns no prior-scope conversation", async () => {
  vi.useFakeTimers();
  let current: ChatResult = { ok: true, message: "", chat: [], pending: { question: "Former identity question", status: "in_flight", message: "Working" } };
  send.mockImplementation(async message => message.type === "getLatest" ? capture : current);
  vi.resetModules(); await import("../src/popup");
  await vi.advanceTimersByTimeAsync(0);
  current = { ok: true, message: "", chat: [] };
  await vi.advanceTimersByTimeAsync(1000);
  expect(elements.question!.value).toBe("");
  expect(elements.chatStatus!.textContent).toBe("");
  expect(elements.ask!.disabled).toBe(false);
  expect(mocks.render).toHaveBeenLastCalledWith(elements.chat, [], expect.any(Function));
});
