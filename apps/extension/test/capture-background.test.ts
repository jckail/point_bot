import { beforeEach, expect, it, vi } from "vitest";
import { pageCandidate } from "../src/capture-state";
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
      set: async (values: Record<string, unknown>) => { Object.assign(stored, values); } } },
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
  expect(await request({ type: "discardCapture" })).toMatchObject({ ok: true, message: expect.stringContaining("does not undo") });
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
