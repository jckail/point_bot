import { beforeEach, expect, it, vi } from "vitest";
import type { ExtensionMessage } from "../src/messages";

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

it("restores persisted rejection guidance and receipt reference on reopening", () => {
  expect(elements.status!.textContent).toContain("Outcome: rejected");
  expect(elements.status!.textContent).toContain("Check PointUp");
  expect(elements.status!.textContent).toContain("Observation: receipt_123");
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
