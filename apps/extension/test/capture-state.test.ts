import { describe, expect, it } from "vitest";
import { captureIdentity, finishCapture, isReviewedCapture, observationRequest, pageCandidate, receiveCapture } from "../src/capture-state";
const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const reading = { providerId: "united", points: 123, sourceUrl: "https://www.united.com/x" };
const first = pageCandidate(null, reading, () => firstId, () => new Date("2026-10-02T01:00:00.000Z"));
const second = pageCandidate(null, reading, () => secondId, () => new Date("2026-10-02T02:00:00.000Z"));
describe("capture replay state", () => {
  it("keeps hydration delivery identity and creates a new identity for changed readings or navigation", () => {
    expect(pageCandidate(first, reading)).toBe(first);
    expect(pageCandidate(first, { ...reading, points: 124 }, () => secondId).captureId).toBe(secondId);
    expect(second.captureId).not.toBe(first.captureId);
    expect(isReviewedCapture(first)).toBe(true);
    expect(isReviewedCapture(reading)).toBe(false); // Legacy reading has no provable original time.
  });
  it("freezes the original time and method in the exact request", () => {
    expect(observationRequest(first)).toEqual({ captureId: firstId, observedAt: first.observedAt, sourceMethod: "page_capture",
      skillId: "united.capture-balance", points: 123, sourceUrl: reading.sourceUrl, agent: "pointup-extension" });
  });
  it("does not let new candidates overwrite a pending submission", () => {
    const pending = { capture: first, identity: "identity", request: observationRequest(first) };
    const state = receiveCapture({ latest: first, pending }, second);
    expect(state.pending).toBe(pending);
    expect(state.latest).toBe(second);
    expect(finishCapture(state, firstId, { ok: true, message: "Recorded", outcome: "recorded" })).toEqual({ latest: second, pending: null, completedIds: [firstId] });
  });
  it("retains held/failed/rejected review and ignores an unrelated completion", () => {
    const state = { latest: first, pending: { capture: first, identity: "identity", request: observationRequest(first) } };
    for (const outcome of ["needs_review", "rejected"] as const) {
      expect(finishCapture(state, firstId, { ok: false, message: "Review", outcome, observationId: "receipt" }).pending?.capture).toBe(first);
    }
    expect(finishCapture(state, firstId, { ok: false, message: "Lost response" }).pending?.request).toEqual(state.pending.request);
    expect(finishCapture(state, secondId, { ok: true, message: "Recorded", outcome: "recorded" })).toBe(state);
  });
  it("binds retries to original settings without storing credentials", async () => {
    const firstIdentity = await captureIdentity("https://pointup.example", "pu_first");
    expect(firstIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(await captureIdentity("https://pointup.example", "pu_first")).toBe(firstIdentity);
    expect(await captureIdentity("https://pointup.example", "pu_other")).not.toBe(firstIdentity);
  });
});
