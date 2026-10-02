import { describe, expect, it } from "vitest";
import { readJsonBody } from "./request-body";

describe("bounded JSON request bodies", () => {
  it("reads JSON and permits an explicitly empty review mutation", async () => {
    await expect(readJsonBody(new Request("https://pointup.test", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: '{"message":"hello"}' }))).resolves.toEqual({ message: "hello" });
    await expect(readJsonBody(new Request("https://pointup.test", { method: "POST" }), true)).resolves.toEqual({});
  });
  it("rejects malformed JSON and unsupported media without echoing private bodies", async () => {
    for (const type of ["application/json", "text/plain"]) {
      const result = readJsonBody(new Request("https://pointup.test", { method: "POST", headers: { "content-type": type }, body: "PRIVATE_BODY" }));
      await expect(result).rejects.toMatchObject({ status: type === "text/plain" ? 415 : 400 });
      await expect(result).rejects.not.toThrow("PRIVATE_BODY");
    }
  });
  it("bounds actual bytes even without a content-length header", async () => {
    await expect(readJsonBody(new Request("https://pointup.test", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(2 * 1024 * 1024 + 1) }))).rejects.toMatchObject({ status: 413, code: "REQUEST_TOO_LARGE" });
  });
  it("cancels chunked chat bodies above 32 KiB without a content-length header", async () => {
    let cancelled = false;
    const chunks = [new Uint8Array(20 * 1024), new Uint8Array(13 * 1024)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://pointup.test", { method: "POST", headers: { "content-type": "application/json" }, body, ...{ duplex: "half" } });
    expect(request.headers.has("content-length")).toBe(false);
    await expect(readJsonBody(request, false, 32 * 1024)).rejects.toMatchObject({
      status: 413, code: "REQUEST_TOO_LARGE", message: "Request body exceeds the allowed size",
    });
    expect(cancelled).toBe(true);
  });
  it("preserves the larger default for portfolio imports", async () => {
    const payload = { import: "x".repeat(40 * 1024) };
    await expect(readJsonBody(new Request("https://pointup.test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }))).resolves.toEqual(payload);
  });
});
