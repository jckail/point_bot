import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirecrawlPageScraper } from "../src/infrastructure/scraper/firecrawl-page-scraper";
import { OpenAiCompatibleAssistant } from "../src/infrastructure/llm/openai-compatible-assistant";
import { HttpAwardAvailabilitySource } from "../src/infrastructure/award-search/award-availability-sources";
import { boundedUpstreamJson } from "../src/infrastructure/http/upstream-transport";
import { IngestDealPage } from "../src/application/loyalty/ingest-deal-page";
import { apiErrorSchema } from "../src/contracts";

const query = { origin: "JFK", destination: "LAX", dateFrom: "2026-11-01", dateTo: "2026-11-02", cabin: "economy" as const };
const privateDetail = "synthetic-private-provider-token URL=https://private.example prompt=private";
const llmInput = { system: "synthetic private portfolio", messages: [{ role: "user" as const, content: "synthetic question" }] };
const adapters = ["scraper", "llm", "award"] as const;
function adapter(kind: typeof adapters[number], baseUrl: string) {
  if (kind === "scraper") return new FirecrawlPageScraper({ baseUrl, apiKey: "fixture-api-key" });
  if (kind === "llm") return new OpenAiCompatibleAssistant({ baseUrl, apiKey: "fixture-api-key" });
  return new HttpAwardAvailabilitySource({ baseUrl, apiKey: "fixture-api-key" });
}
async function invoke(kind: typeof adapters[number], baseUrl: string) {
  if (kind === "scraper") return new FirecrawlPageScraper({ baseUrl, apiKey: "fixture-api-key" }).scrape("https://page.example/fixture");
  if (kind === "llm") return new OpenAiCompatibleAssistant({ baseUrl, apiKey: "fixture-api-key" }).complete(llmInput);
  return new HttpAwardAvailabilitySource({ baseUrl, apiKey: "fixture-api-key" }).searchAwards(query);
}
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => resolve()); });
}
afterEach(() => vi.unstubAllGlobals());

describe("credential-bearing upstream adapters", () => {
  it.each(adapters)("validates %s configuration before fetch", kind => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    for (const baseUrl of ["http://vendor.example", "https://user:secret@vendor.example", "https://vendor.example?", "https://vendor.example?q=private", "https://vendor.example#", "https://vendor.example#private", "bad", "https://vendor.example\\private"]) {
      expect(() => adapter(kind, baseUrl)).toThrow(/Upstream URL/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => adapter(kind, "http://localhost:8787/v1")).not.toThrow();
  });
  it("preserves successful envelopes and private request boundaries with redirects disabled", async () => {
    const fetchMock = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith("/v1/scrape")) return Response.json({ success: true, data: { markdown: " Page content ", metadata: { title: "Page", sourceURL: "https://page.example/fixture" } } });
      if (String(url).endsWith("/chat/completions")) return Response.json({ choices: [{ message: { content: " Answer " } }] });
      return Response.json({ options: [{ program: "united", date: "2026-11-01", cabin: "economy", points: 10000 }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await invoke("scraper", "https://vendor.example/prefix")).toMatchObject({ markdown: "Page content", title: "Page" });
    expect(await invoke("llm", "https://vendor.example/v1")).toBe("Answer");
    expect(await invoke("award", "https://vendor.example")).toMatchObject({ status: "ok", options: [{ programId: "united", pointsCost: 10000 }] });
    for (const call of fetchMock.mock.calls) {
      const init = (call as unknown as [unknown, RequestInit])[1];
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-api-key");
    }
  });
  it.each(adapters)("never copies non-2xx private %s bodies into errors/results", async kind => {
    const text = vi.fn(async () => privateDetail);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, body: null, text })));
    try {
      const result = await invoke(kind, "https://vendor.example");
      expect(result).toMatchObject({ status: "error", options: [] });
      expect(JSON.stringify(result)).not.toContain(privateDetail);
    } catch (error) {
      expect(error).not.toHaveProperty("cause");
      expect((error as Error).message).not.toContain(privateDetail);
    }
    expect(text).not.toHaveBeenCalled();
  });
  it.each(adapters)("hides private thrown and malformed JSON errors for %s", async kind => {
    for (const reply of [async () => { throw new Error(privateDetail, { cause: new Error(privateDetail) }); }, async () => new Response(privateDetail)]) {
      vi.stubGlobal("fetch", vi.fn(reply));
      try {
        const result = await invoke(kind, "https://vendor.example");
        expect(result).toMatchObject({ status: "error", options: [] });
        expect(JSON.stringify(result)).not.toContain("synthetic-private");
      } catch (error) {
        expect(error).not.toHaveProperty("cause");
        expect((error as Error).message).not.toContain("synthetic-private");
      }
    }
  });
  it.each(adapters)("cancels oversized chunked %s responses", async kind => {
    const cancel = vi.fn(); const maxBytes = kind === "scraper" ? 1024 * 1024 : 256 * 1024;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(maxBytes)); controller.enqueue(new Uint8Array(1)); }, cancel });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
    if (kind === "award") expect(await invoke(kind, "https://vendor.example")).toMatchObject({ status: "error", options: [] });
    else await expect(invoke(kind, "https://vendor.example")).rejects.toThrow(/Retry later/);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(adapters)("real local redirect cannot forward %s request to another destination", async kind => {
    let destinationCalls = 0; const received: string[] = [];
    const destination = createServer((_request, response) => { destinationCalls++; response.end("{}"); });
    let source: Server | undefined;
    try {
      const destinationUrl = await listen(destination);
      source = createServer((request, response) => {
        request.setEncoding("utf8"); request.on("data", chunk => received.push(String(chunk)));
        request.on("end", () => { response.writeHead(307, { Location: `${destinationUrl}/unapproved` }); response.end(); });
      });
      const baseUrl = await listen(source);
      if (kind === "award") expect(await invoke(kind, baseUrl)).toMatchObject({ status: "error", options: [] });
      else await expect(invoke(kind, baseUrl)).rejects.toThrow(/Retry later/);
      expect(destinationCalls).toBe(0);
      if (kind === "llm") expect(received.join("")).toContain(llmInput.system);
    } finally { await Promise.all([close(destination), ...(source ? [close(source)] : [])]); }
  });
  it("bounds bodyless injected text by UTF-8 bytes", async () => {
    const response = { body: null, text: async () => JSON.stringify({ text: "旅".repeat(20) }) } as Response;
    await expect(boundedUpstreamJson(response, 32)).rejects.toThrow("Upstream response is unavailable.");
  });
  it("keeps alternate scraper failures private at the public domain/API boundary", async () => {
    const original = new Error(privateDetail, { cause: new Error("private-cause") });
    const useCase = new IngestDealPage({ scrape: async () => { throw original; } });
    try { await useCase.execute({ url: "https://page.example/fixture" }); }
    catch (error) {
      expect(error).toMatchObject({ code: "SCRAPE_FAILED", message: "Page scrape failed: Could not load this page. Retry later." });
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(apiErrorSchema.parse({ error: { code: "SCRAPE_FAILED", message: (error as Error).message } }))).not.toContain("synthetic-private");
    }
    expect(original.message).toBe(privateDetail);
  });
});
