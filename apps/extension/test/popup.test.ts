import { readFileSync } from "node:fs";
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
  querySelectorAll() { return [elements.ask!, elements.clearChat!, elements.reviewProposals!]; }
}
const elements: Record<string, Element> = {};
const capture = { captureId: "00000000-0000-4000-8000-000000000001", providerId: "united", points: 123,
  observedAt: "2026-10-02T01:00:00.000Z", sourceMethod: "page_capture", retryLocked: true,
  receipt: { ok: false, outcome: "rejected", message: "Observation rejected. Check PointUp before creating another capture.", observationId: "receipt_123", reviewId: null } };
const send = vi.fn(async (message: ExtensionMessage): Promise<unknown> => message.type === "getLatest" ? capture : { ok: true, message: "", chat: [] });
async function flush() { await new Promise(resolve => setTimeout(resolve, 0)); }
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  for (const id of ["latest", "record", "discardCapture", "openObservationReview", "baseUrl", "token", "save", "status", "assistant", "askForm", "question", "chat", "chatStatus", "ask", "clearChat", "reviewProposals"]) elements[id] = new Element();
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

it("shows an acknowledged receipt before refresh and retains it when refreshing fails", async () => {
  let failRefresh!: (error: Error) => void;
  send.mockImplementation(async message => message.type === "record"
    ? { ok: true, outcome: "recorded", message: "Recorded", observationId: "obs_confirmed" }
    : new Promise((_resolve, reject) => { failRefresh = reject; }));
  elements.record!.listeners.click!(); await flush();
  expect(elements.status!.textContent).toContain("Observation: obs_confirmed");
  failRefresh(new Error("private worker error")); await flush();
  expect(elements.status!.textContent).toContain("Outcome: recorded");
  expect(elements.status!.textContent).toContain("Observation: obs_confirmed");
  expect(elements.status!.textContent).toContain("Capture view unavailable");
  expect(elements.status!.textContent).not.toMatch(/retry|unknown|private worker/);
  expect(elements.record!.disabled).toBe(true);
  expect(elements.discardCapture!.disabled).toBe(true);
  expect(elements.save!.disabled).toBe(false);
  elements.record!.listeners.click!(); await flush();
  expect(send.mock.calls.filter(([message]) => message.type === "record")).toHaveLength(1);
});
it("keeps a held receipt when the post-action completed-receipt read fails", async () => {
  send.mockImplementation(async message => message.type === "record"
    ? { ok: false, outcome: "needs_review", message: "Review in PointUp", observationId: "obs_held", reviewId: "review_held" }
    : message.type === "getLatest" ? null : Promise.reject(new Error("receipt read failed")));
  elements.record!.listeners.click!(); await flush();
  expect(elements.status!.textContent).toContain("Outcome: needs_review");
  expect(elements.status!.textContent).toContain("Review: review_held");
  expect(elements.status!.textContent).toContain("Capture view unavailable");
  expect(elements.status!.textContent).not.toContain("Keep your capture and retry");
  expect(elements.record!.disabled).toBe(true);
});
it("preserves acknowledged discard when refreshing the capture view fails", async () => {
  send.mockImplementation(async message => message.type === "discardCapture"
    ? { ok: true, message: "Discarded local review. This does not undo a submission." }
    : Promise.reject(new Error("worker refresh failed")));
  elements.discardCapture!.listeners.click!(); await flush();
  expect(elements.status!.textContent).toContain("Discarded local review");
  expect(elements.status!.textContent).toContain("Capture view unavailable");
  expect(elements.status!.textContent).not.toContain("Keep your capture and retry");
  expect(elements.discardCapture!.disabled).toBe(true);
});

it("opens proposed-action review from an empty uncertain conversation without resending or losing support guidance", async () => {
  const pending = { question: "First interrupted question", status: "uncertain" as const,
    message: "Outcome unknown. Check proposed actions before explicitly retrying. Support reference: trace.run:1234" };
  let finishReview!: (result: ChatResult) => void;
  send.mockImplementation(async message => message.type === "getLatest" ? capture
    : message.type === "getChat" ? { ok: true, message: "", chat: [], pending }
      : new Promise<ChatResult>(resolve => { finishReview = resolve; }));
  vi.resetModules(); await import("../src/popup"); await flush();
  expect(elements.reviewProposals!.disabled).toBe(false);
  expect(mocks.render).toHaveBeenLastCalledWith(elements.chat, [], expect.any(Function));
  elements.reviewProposals!.listeners.click!(); await flush();
  expect(send).toHaveBeenCalledWith({ type: "openReview" });
  expect(elements.chatStatus!.textContent).toContain(pending.message);
  expect(elements.chatStatus!.textContent).toContain("Opening proposed changes");
  expect(elements.reviewProposals!.disabled).toBe(true);
  finishReview({ ok: true, message: "Review and approve proposed actions in PointUp." }); await flush();
  expect(elements.chatStatus!.textContent).toContain(pending.message);
  expect(elements.chatStatus!.textContent).toContain("Review and approve");
  expect(elements.question!.value).toBe(pending.question);
  expect(elements.reviewProposals!.disabled).toBe(false);
  expect(send.mock.calls.some(([message]) => message.type === "ask" || message.type === "clearChat")).toBe(false);
});

it("preserves recovery guidance when a proposal-card navigation fails", async () => {
  const pending = { question: "Saved question", status: "uncertain" as const,
    message: "Check proposed actions before retrying. Support reference: saved-request" };
  send.mockImplementation(async message => message.type === "getLatest" ? capture
    : message.type === "getChat" ? { ok: true, message: "", chat: [], pending }
      : { ok: false, message: "Review navigation unavailable. Reopen PointUp." });
  vi.resetModules(); await import("../src/popup"); await flush();
  const cardReview = mocks.render.mock.calls.at(-1)?.[2] as () => void;
  cardReview(); await flush();
  expect(elements.chatStatus!.textContent).toContain(pending.message);
  expect(elements.chatStatus!.textContent).toContain("Review navigation unavailable");
  expect(elements.question!.value).toBe(pending.question);
  expect(send.mock.calls.filter(([message]) => message.type === "openReview")).toHaveLength(1);
  expect(send.mock.calls.some(([message]) => message.type === "ask")).toBe(false);
});

it("disables the always-present review action during inference without opening tabs or sending another ask", async () => {
  send.mockImplementation(async message => message.type === "getLatest" ? capture
    : { ok: true, message: "", chat: [], pending: { question: "Working question", status: "in_flight", message: "Working" } });
  vi.useFakeTimers(); vi.resetModules(); await import("../src/popup"); await vi.advanceTimersByTimeAsync(0);
  expect(elements.reviewProposals!.disabled).toBe(true);
  elements.reviewProposals!.listeners.click!(); await vi.advanceTimersByTimeAsync(0);
  expect(send.mock.calls.some(([message]) => message.type === "openReview" || message.type === "ask")).toBe(false);
});

it("ships an always-present non-submitting proposal review control in the popup markup", () => {
  const html = readFileSync(new URL("../public/popup.html", import.meta.url), "utf8");
  expect(html).toContain('<button id="reviewProposals" type="button">Review proposed changes in PointUp</button>');
});


it.each([
  { name: "endpoint", baseUrl: "https://other.example/dashboard", token: "pu_original", origin: "https://other.example" },
  { name: "token", baseUrl: "https://pointup.example/dashboard", token: "pu_rotated", origin: "https://pointup.example" },
])("clears an unsent draft after successful $name rotation and sends only a new explicit question", async ({ baseUrl, token, origin }) => {
  elements.question!.value = "Private unsent question from the original scope";
  elements.baseUrl!.value = baseUrl;
  elements.token!.value = token;
  elements.save!.listeners.click!(); await flush();
  expect(mocks.save).toHaveBeenCalledWith({ baseUrl: origin, token });
  expect(elements.question!.value).toBe("");
  expect(send).toHaveBeenCalledWith({ type: "clearChat" });
  expect(send.mock.calls.some(([message]) => message.type === "ask" || message.type === "record" || message.type === "discardCapture")).toBe(false);
  expect(elements.latest!.textContent).toContain(capture.points.toLocaleString());
  expect(elements.status!.textContent).toContain("Pending captures keep their original identity");

  elements.question!.value = "New scope explicit question";
  const submit = elements.askForm!.listeners.submit as unknown as (event: { preventDefault: () => void }) => void;
  submit({ preventDefault: () => {} }); await flush();
  expect(send.mock.calls.filter(([message]) => message.type === "ask")).toEqual([
    [{ type: "ask", message: "New scope explicit question" }],
  ]);
});

it("clears a modified uncertain draft after successful settings rotation without replaying it", async () => {
  const pending = { question: "Original uncertain question", status: "uncertain" as const,
    message: "Outcome unknown. Check proposed actions before explicitly retrying. Support reference: old-scope-request" };
  send.mockImplementation(async message => message.type === "getLatest" ? capture
    : message.type === "getChat" ? { ok: true, message: "", chat: [], pending }
      : { ok: true, message: "", chat: [] });
  vi.resetModules(); await import("../src/popup"); await flush();
  expect(elements.question!.value).toBe(pending.question);
  elements.question!.value = "Edited private question from the old scope";
  elements.baseUrl!.value = "https://other.example";
  elements.token!.value = "pu_rotated";
  elements.save!.listeners.click!(); await flush();
  expect(mocks.save).toHaveBeenCalledWith({ baseUrl: "https://other.example", token: "pu_rotated" });
  expect(elements.question!.value).toBe("");
  expect(elements.chatStatus!.textContent).not.toContain("old-scope-request");
  expect(send.mock.calls.some(([message]) => message.type === "ask" || message.type === "record" || message.type === "discardCapture")).toBe(false);
});

it.each(["busy response", "transport failure"])("clears the old draft after settings save even when clearChat has a %s", async failure => {
  elements.question!.value = "Private unsent old-scope draft";
  elements.token!.value = "pu_rotated";
  send.mockImplementation(async message => {
    if (message.type === "clearChat") {
      if (failure === "transport failure") throw new Error("private worker transport details");
      return { ok: false, message: "The assistant is working. Please wait." };
    }
    return message.type === "getLatest" ? capture : { ok: true, message: "", chat: [] };
  });
  elements.save!.listeners.click!(); await flush();
  expect(mocks.save).toHaveBeenCalledWith({ baseUrl: "https://pointup.example", token: "pu_rotated" });
  expect(elements.question!.value).toBe("");
  expect(elements.status!.textContent).toContain("Settings saved. Conversation could not be cleared");
  expect(elements.status!.textContent).not.toContain("private worker transport details");
  expect(elements.save!.disabled).toBe(false);
  expect(send.mock.calls.some(([message]) => message.type === "ask" || message.type === "record" || message.type === "discardCapture")).toBe(false);
});

it("preserves an unsent draft when settings persistence fails without clearing or sending it", async () => {
  const draft = "Private draft retained after failed Save";
  elements.question!.value = draft;
  elements.baseUrl!.value = "https://other.example";
  elements.token!.value = "pu_rotated";
  mocks.save.mockRejectedValueOnce(new Error("private storage failure details"));
  elements.save!.listeners.click!(); await flush();
  expect(elements.question!.value).toBe(draft);
  expect(elements.status!.textContent).toContain("Settings could not be saved");
  expect(elements.status!.textContent).not.toContain("private storage failure details");
  expect(elements.save!.disabled).toBe(false);
  expect(send.mock.calls.some(([message]) => message.type === "clearChat" || message.type === "ask" || message.type === "record" || message.type === "discardCapture")).toBe(false);
});


it.each(["reply", "error response", "transport failure"])("ignores delayed old-scope hydration %s after successful Save", async outcome => {
  let finish!: (result: ChatResult) => void;
  let fail!: (error: Error) => void;
  send.mockImplementation(async message => message.type === "getLatest" ? capture
    : message.type === "getChat" ? new Promise<ChatResult>((resolve, reject) => { finish = resolve; fail = reject; })
      : { ok: true, message: "", chat: [] });
  vi.resetModules(); await import("../src/popup"); await flush();
  elements.question!.value = "Unsent original-scope draft";
  elements.baseUrl!.value = "https://other.example";
  elements.token!.value = "pu_rotated";
  elements.save!.listeners.click!(); await flush();
  expect(elements.question!.value).toBe("");
  const feedback = elements.chatStatus!.textContent;
  const savedFeedback = elements.status!.textContent;
  if (outcome === "transport failure") fail(new Error("private old-scope transport detail"));
  else if (outcome === "error response") finish({ ok: false, message: "Old-scope read unavailable" });
  else finish({ ok: true, message: "", chat: [{ role: "assistant", content: "Old private transcript" }],
    pending: { question: "Old uncertain question", status: "uncertain", message: "Old support reference" } });
  await flush();
  expect(elements.question!.value).toBe("");
  expect(elements.chatStatus!.textContent).toBe(feedback);
  expect(elements.status!.textContent).toBe(savedFeedback);
  expect(mocks.render).toHaveBeenLastCalledWith(elements.chat, [], expect.any(Function));
  expect(elements.ask!.disabled).toBe(false);
  expect(send.mock.calls.some(([message]) => message.type === "ask" || message.type === "record" || message.type === "discardCapture")).toBe(false);
});

it("retains valid delayed hydration when settings Save fails", async () => {
  let finish!: (result: ChatResult) => void;
  send.mockImplementation(async message => message.type === "getLatest" ? capture
    : message.type === "getChat" ? new Promise<ChatResult>(resolve => { finish = resolve; })
      : { ok: true, message: "", chat: [] });
  vi.resetModules(); await import("../src/popup"); await flush();
  mocks.save.mockRejectedValueOnce(new Error("Storage unavailable"));
  elements.token!.value = "pu_unsaved";
  elements.save!.listeners.click!(); await flush();
  const chat: ChatResult["chat"] = [{ role: "assistant", content: "Current saved-scope transcript" }];
  finish({ ok: true, message: "", chat,
    pending: { question: "Current saved-scope question", status: "uncertain", message: "Check proposals before retrying" } });
  await flush();
  expect(mocks.render).toHaveBeenLastCalledWith(elements.chat, chat, expect.any(Function));
  expect(elements.question!.value).toBe("Current saved-scope question");
  expect(elements.chatStatus!.textContent).toBe("Check proposals before retrying");
  expect(elements.status!.textContent).toContain("Settings could not be saved");
  expect(send.mock.calls.some(([message]) => message.type === "ask" || message.type === "clearChat")).toBe(false);
});

it.each(["ask", "clearChat"])("does not restore initial hydration after a newer %s completes", async action => {
  let finish!: (result: ChatResult) => void;
  const current: ChatResult = { ok: true, message: action === "clearChat" ? "Conversation cleared." : "",
    chat: action === "ask" ? [{ role: "user", content: "New explicit question" }, { role: "assistant", content: "Current answer" }] : [] };
  send.mockImplementation(async message => message.type === "getLatest" ? capture
    : message.type === "getChat" ? new Promise<ChatResult>(resolve => { finish = resolve; }) : current);
  vi.resetModules(); await import("../src/popup"); await flush();
  if (action === "ask") {
    elements.question!.value = "New explicit question";
    const submit = elements.askForm!.listeners.submit as unknown as (event: { preventDefault: () => void }) => void;
    submit({ preventDefault: () => {} });
  } else elements.clearChat!.listeners.click!();
  await flush();
  const feedback = elements.chatStatus!.textContent;
  finish({ ok: true, message: "", chat: [{ role: "assistant", content: "Obsolete initial transcript" }],
    pending: { question: "Obsolete question", status: "uncertain", message: "Obsolete uncertainty" } });
  await flush();
  expect(mocks.render).toHaveBeenLastCalledWith(elements.chat, current.chat, expect.any(Function));
  expect(elements.question!.value).toBe("");
  expect(elements.chatStatus!.textContent).toBe(feedback);
  expect(send.mock.calls.filter(([message]) => message.type === action)).toHaveLength(1);
  expect(send.mock.calls.filter(([message]) => message.type === "ask")).toHaveLength(action === "ask" ? 1 : 0);
});
