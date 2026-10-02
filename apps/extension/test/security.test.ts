import { describe, expect, it } from "vitest";
import { apiOrigin, CAPTURE_TTL_MS, isPopupSender, isReviewedCapture, providerForUrl } from "../src/security";

describe("extension trust boundaries", () => {
  it("accepts only secure or local API origins without hidden credentials", () => {
    expect(apiOrigin("https://app.example.com/")).toBe("https://app.example.com");
    expect(apiOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    for (const url of ["http://app.example.com", "https://user:secret@app.example.com", "https://app.example.com/path", "https://app.example.com/?token=secret", "https://app.example.com/#secret"]) expect(() => apiOrigin(url)).toThrow();
  });
  it("rejects lookalikes and insecure provider pages", () => {
    expect(providerForUrl("https://www.united.com/a")).toBe("united");
    for (const url of ["https://united.com.attacker.test", "http://united.com", "https://user@united.com", "garbage"]) expect(providerForUrl(url)).toBeNull();
  });
  it("only trusts the exact extension popup", () => {
    const url = "chrome-extension://trusted/popup.html";
    expect(isPopupSender({ id: "trusted", url }, "trusted", url)).toBe(true);
    expect(isPopupSender({ id: "trusted", url, tab: {} }, "trusted", url)).toBe(false);
    expect(isPopupSender({ id: "other", url }, "trusted", url)).toBe(false);
    expect(isPopupSender({ id: "trusted", url: "https://united.com" }, "trusted", url)).toBe(false);
  });
  it("rejects stale, future, mismatched and malformed reviews", () => {
    const now = 1000000;
    const capture = { id: "review", sourceOrigin: "https://united.com", providerId: "united", points: 0, capturedAt: now };
    expect(isReviewedCapture(capture, now)).toBe(true);
    for (const patch of [{ capturedAt: now - CAPTURE_TTL_MS }, { capturedAt: now + 1 }, { providerId: "delta" }, { points: -1 }, { points: 1.5 }, { points: Number.MAX_SAFE_INTEGER + 1 }, { id: "" }]) expect(isReviewedCapture({ ...capture, ...patch }, now)).toBe(false);
    expect(isReviewedCapture(null, now)).toBe(false);
  });
});
