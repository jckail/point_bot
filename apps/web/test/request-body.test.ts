import { describe, expect, it } from "vitest";
import { readJsonBody } from "../src/server/request-body";

const request = (body: string, type = "application/json") => new Request("https://pointup.io/api/v1/import", { method: "POST", body, headers: { "content-type": type } });
describe("mutation request bodies", () => {
  it("reads valid JSON including unicode", async () => {
    await expect(readJsonBody(request('{"title":"京都"}'))).resolves.toEqual({ title: "京都" });
  });
  it("returns a request error for malformed JSON instead of an internal failure", async () => {
    await expect(readJsonBody(request('{"title":'))).rejects.toMatchObject({ status: 400, code: "INVALID_REQUEST" });
  });
  it("permits missing optional bodies but does not hide malformed JSON", async () => {
    await expect(readJsonBody(new Request("https://pointup.io", { method: "POST" }), true)).resolves.toEqual({});
    await expect(readJsonBody(request("{"), true)).rejects.toMatchObject({ status: 400 });
  });
  it("rejects non-JSON media types", async () => {
    await expect(readJsonBody(request("{}", "text/plain"))).rejects.toMatchObject({ status: 415 });
  });
  it("bounds actual streamed bytes even if Content-Length is absent", async () => {
    await expect(readJsonBody(request('"' + "x".repeat(2 * 1024 * 1024) + '"'))).rejects.toMatchObject({ status: 413 });
  });
});
