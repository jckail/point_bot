import { beforeEach, expect, it, vi } from "vitest";
import { captureIdentity, observationRequest, pageCandidate } from "../src/capture-state";
import type { ExtensionMessage } from "../src/messages";

const stored: Record<string, unknown> = {};
let listener: (message: ExtensionMessage, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => unknown;
const popup = { id: "extension", url: "chrome-extension://extension/popup.html" };
const capture = pageCandidate(null, { providerId: "united", points: 123, sourceUrl: "https://www.united.com/x" },
  () => "00000000-0000-4000-8000-000000000001", () => new Date("2026-10-02T01:00:00.000Z"));
const newer = pageCandidate(null, { ...capture, points: 124 }, () => "00000000-0000-4000-8000-000000000002");
async function startWorker() { vi.resetModules(); await import("../src/background"); }
function request(message: ExtensionMessage): Promise<unknown> { return new Promise(resolve => { listener(message, popup, resolve); }); }
async function deliver(value = capture) {
  listener({ type: "capture", capture: value }, { id: "extension", url: value.sourceUrl }, () => undefined);
  await request({ type: "getLatest" }); // Storage queue barrier.
}
beforeEach(async () => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const key of Object.keys(stored)) delete stored[key];
  stored.baseUrl = "https://pointup.example"; stored.token = "pu_original";
  vi.stubGlobal("chrome", { runtime: { id: "extension", getURL: () => popup.url, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    storage: { local: { get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]])),
      set: async (values: Record<string, unknown>) => { Object.assign(stored, values); } },
      session: { get: async (key: string) => ({ [key]: stored[key] }), set: async (values: Record<string, unknown>) => { Object.assign(stored, values); } } },
    tabs: { create: vi.fn(async () => ({ id: 31 })), get: vi.fn(async () => ({ id: 31 })), update: vi.fn(async () => ({ id: 31 })) },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined) } });
  await startWorker();
});
it("persists exact retries over worker restart and refuses changed settings", async () => {
  await deliver();
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => { calls.push(init.body as string); throw new Error("response lost"); }));
  expect(await request({ type: "record", captureId: capture.captureId })).toMatchObject({ ok: false });
  await deliver(newer);
  await startWorker();
  expect(await request({ type: "getLatest" })).toMatchObject({ captureId: capture.captureId, retryLocked: true });
  stored.token = "pu_rotated";
  expect(await request({ type: "record", captureId: capture.captureId })).toMatchObject({ ok: false, message: expect.stringContaining("settings changed") });
  expect(calls).toHaveLength(1);
  stored.token = "pu_original";
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    calls.push(init.body as string);
    return new Response(JSON.stringify({ outcome: "recorded", accountId: "a", points: 123, previousPoints: null, message: "Recorded", reviewId: null, observationId: "receipt" }));
  }));
  expect(await request({ type: "record", captureId: capture.captureId })).toMatchObject({ ok: true, observationId: "receipt" });
  expect(calls[1]).toBe(calls[0]);
  expect(await request({ type: "getLatest" })).toMatchObject({ captureId: newer.captureId });
});
it("keeps a held receipt for dashboard recovery and deliberately discards only the pending review", async () => {
  await deliver();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ outcome: "needs_review", accountId: "a", points: 123, previousPoints: 1, message: "Held", reviewId: "review", observationId: "receipt" }))));
  await request({ type: "record", captureId: capture.captureId });
  await deliver(newer);
  expect(await request({ type: "getLatest" })).toMatchObject({ retryLocked: true, receipt: { outcome: "needs_review", reviewId: "review" } });
  expect(await request({ type: "discardCapture", captureId: capture.captureId })).toMatchObject({ ok: true, message: expect.stringContaining("does not undo") });
  expect(await request({ type: "getLatest" })).toMatchObject({ captureId: newer.captureId });
});
it("requires a fresh capture for legacy storage and rejects stale popup recording", async () => {
  stored.latestCapture = { providerId: "united", points: 123, sourceUrl: "https://www.united.com/x" };
  expect(await request({ type: "getLatest" })).toBeNull();
  await deliver(newer);
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await request({ type: "record", captureId: capture.captureId })).toMatchObject({ ok: false, message: expect.stringContaining("Capture changed") });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects stale discard without deleting or tombstoning the newer candidate", async () => {
  await deliver(capture);
  await deliver(newer);
  const before = structuredClone(stored.captureState);
  expect(await request({ type: "discardCapture", captureId: capture.captureId })).toMatchObject({ ok: false, message: expect.stringContaining("Capture changed") });
  expect(stored.captureState).toEqual(before);
  expect(await request({ type: "getLatest" })).toMatchObject({ captureId: newer.captureId });
});

it("rejects queued discard after completion instead of discarding the next candidate", async () => {
  await deliver();
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async () => new Promise<Response>(resolve => { finish = resolve; })));
  const recording = request({ type: "record", captureId: capture.captureId });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  listener({ type: "capture", capture: newer }, { id: "extension", url: newer.sourceUrl }, () => undefined);
  const discard = request({ type: "discardCapture", captureId: capture.captureId });
  finish(new Response(JSON.stringify({ outcome: "recorded", accountId: "a", points: 123, previousPoints: null, message: "Recorded", reviewId: null })));
  await recording;
  expect(await discard).toMatchObject({ ok: false });
  expect(await request({ type: "getLatest" })).toMatchObject({ captureId: newer.captureId });
  expect((stored.captureState as { completedIds: string[] }).completedIds).not.toContain(newer.captureId);
});

it("shares one review tab across simultaneous assistant and observation requests", async () => {
  await Promise.all([request({ type: "openReview" }), request({ type: "openObservationReview" })]);
  expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  expect(chrome.tabs.update).toHaveBeenCalledWith(31, { url: "https://pointup.example/dashboard/agents", active: true });
});

it("ignores queued late hydration delivery after completion and after worker restart", async () => {
  await deliver();
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async () => new Promise<Response>(resolve => { finish = resolve; })));
  const recording = request({ type: "record", captureId: capture.captureId });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  listener({ type: "capture", capture }, { id: "extension", url: capture.sourceUrl }, () => undefined);
  finish(new Response(JSON.stringify({ outcome: "recorded", accountId: "a", points: 123, previousPoints: null, message: "Recorded", reviewId: null })));
  await recording;
  expect(await request({ type: "getLatest" })).toBeNull();
  await startWorker();
  await deliver();
  expect(await request({ type: "getLatest" })).toBeNull();
  await deliver(newer);
  expect(await request({ type: "getLatest" })).toMatchObject({ captureId: newer.captureId });
});
it("bounds recording to 25 seconds and retains the frozen review on timeout", async () => {
  await deliver();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }));
  expect(await request({ type: "record", captureId: capture.captureId })).toMatchObject({ ok: false, message: expect.stringContaining("took too long") });
  expect(timeout).toHaveBeenCalledWith(25_000);
  expect(await request({ type: "getLatest" })).toMatchObject({ captureId: capture.captureId, retryLocked: true });
});
it("new pasted settings use the same origin for capture and chat without modifying a frozen request", async () => {
  const { saveConfig } = await import("../src/config");
  await saveConfig({ baseUrl: "https://pointup.example/dashboard", token: "pu_original" });
  await deliver();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("assistant/chat")
    ? { reply: "Answer" } : { outcome: "recorded", accountId: "a", points: 123, previousPoints: 1, message: "Recorded", observationId: "receipt_origin" })));
  vi.stubGlobal("fetch", fetchMock);
  await request({ type: "record", captureId: capture.captureId });
  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://pointup.example/api/v1/agent/observations");
  await request({ type: "ask", message: "My points?" });
  expect(fetchMock.mock.calls[1]?.[0]).toBe("https://pointup.example/api/v1/assistant/chat");
  const frozen = structuredClone(stored.captureState);
  await saveConfig({ baseUrl: "https://other.example/dashboard", token: "pu_other" });
  expect(stored.captureState).toEqual(frozen);
});
it("does not rewrite or replay an old frozen page-path request after explicit settings normalization", async () => {
  const { saveConfig } = await import("../src/config");
  stored.baseUrl = "https://pointup.example/dashboard";
  stored.captureState = { latest: capture, pending: { capture,
    identity: await captureIdentity(stored.baseUrl as string, "pu_original"), request: observationRequest(capture) } };
  const frozen = structuredClone(stored.captureState);
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await request({ type: "record", captureId: capture.captureId })).toMatchObject({ ok: false, message: expect.stringContaining("check PointUp") });
  await saveConfig({ baseUrl: "https://pointup.example/dashboard", token: "pu_original" });
  expect(await request({ type: "record", captureId: capture.captureId })).toMatchObject({ ok: false, message: expect.stringContaining("settings changed") });
  expect(stored.captureState).toEqual(frozen);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("refuses legacy page-path capture settings with remediation and no network or identity rewrite", async () => {
  stored.baseUrl = "https://pointup.example/dashboard";
  await deliver();
  const before = structuredClone(stored.captureState);
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await request({ type: "record", captureId: capture.captureId })).toMatchObject({ ok: false, message: expect.stringContaining("Save settings again") });
  expect(stored.captureState).toEqual(before);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("recovers a completed receipt after restart without resubmission or hiding newer captures, scoped to original settings", async () => {
  await deliver();
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ outcome: "unchanged", accountId: "a", points: 123, previousPoints: 123, message: "Already current", observationId: "receipt_completed" })));
  vi.stubGlobal("fetch", fetchMock);
  await request({ type: "record", captureId: capture.captureId });
  await startWorker();
  expect(await request({ type: "getLatest" })).toBeNull();
  expect(await request({ type: "getCaptureReceipt" })).toMatchObject({ ok: true, outcome: "unchanged", observationId: "receipt_completed" });
  await deliver(newer);
  expect(await request({ type: "getLatest" })).toMatchObject({ captureId: newer.captureId });
  expect(await request({ type: "getCaptureReceipt" })).toMatchObject({ observationId: "receipt_completed" });
  stored.token = "pu_other";
  expect(await request({ type: "getCaptureReceipt" })).toBeNull();
  stored.token = "pu_original"; stored.baseUrl = "https://other.example";
  expect(await request({ type: "getCaptureReceipt" })).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("retains a legacy manual completion without claiming observation idempotency or a server receipt", async () => {
  stored.token = "clerk_session";
  await deliver();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("loyalty-accounts")
    ? [{ id: "account", provider: { id: "united", displayName: "United" } }] : {})));
  vi.stubGlobal("fetch", fetchMock);
  expect(await request({ type: "record", captureId: capture.captureId })).toMatchObject({ ok: true });
  await startWorker();
  const receipt = await request({ type: "getCaptureReceipt" });
  expect(receipt).toMatchObject({ ok: true, message: "Recorded 123 for United." });
  expect(receipt).not.toHaveProperty("observationId");
  expect(receipt).not.toHaveProperty("outcome");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
