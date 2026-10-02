import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { HttpAggregatorTravelProviderGateway, type AggregatorFetch } from "../src/infrastructure/providers/http-aggregator-travel-provider-gateway";
import { asUserId } from "./ids";

const account = createLoyaltyAccount({ userId: asUserId("synthetic-owner"), providerId: "united", membershipNumber: "fixture-member" });
const credentials = { username: "fixture-user", secret: "fixture-transient-secret" };
const config = { baseUrl: "https://synthetic.example/prefix", apiKey: "fixture-api-key" };
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture listener");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
}

describe("aggregator transport boundaries", () => {
  it.each(["http://vendor.example", "https://user:secret@vendor.example", "https://vendor.example?", "https://vendor.example?q=private", "https://vendor.example#", "https://vendor.example#fragment", "file:///private", "not-a-url", " https://vendor.example", "https://vendor.example\\other"])(
    "rejects invalid configuration before credential transmission: %s", baseUrl => {
      const fetchImpl = vi.fn<AggregatorFetch>();
      expect(() => new HttpAggregatorTravelProviderGateway({ ...config, baseUrl, fetchImpl })).toThrow(/Aggregator URL/);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it("preserves a configured HTTPS base prefix and rejects redirect following explicitly", async () => {
    const fetchImpl = vi.fn<AggregatorFetch>().mockResolvedValue({ ok: true, status: 200, text: async () => '{"points":124300.6}' });
    const gateway = new HttpAggregatorTravelProviderGateway({ ...config, fetchImpl, supportedProviderIds: ["united"] });
    expect(gateway.supports("hyatt")).toBe(false);
    expect(await gateway.fetchBalance(account, credentials)).toEqual({ points: 124301 });
    expect(fetchImpl).toHaveBeenCalledWith("https://synthetic.example/prefix/v1/balance", expect.objectContaining({
      redirect: "error", headers: { Authorization: "Bearer fixture-api-key", "Content-Type": "application/json" },
    }));
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ credential: credentials });
  });
  it.each([307, 308])("real local HTTP %i redirect cannot forward transient credentials", async status => {
    let destinationCalls = 0, sourceBody = "", sourceAuthorization: string | undefined;
    const destination = createServer((_request, response) => { destinationCalls += 1; response.end('{"points":1}'); });
    let source: Server | undefined;
    try {
      const destinationUrl = await listen(destination);
      source = createServer((request, response) => {
        sourceAuthorization = request.headers.authorization;
        request.setEncoding("utf8");
        request.on("data", chunk => { sourceBody += String(chunk); });
        request.on("end", () => { response.writeHead(status, { Location: `${destinationUrl}/steal` }); response.end(); });
      });
      const baseUrl = await listen(source);
      const gateway = new HttpAggregatorTravelProviderGateway({ ...config, baseUrl });
      await expect(gateway.fetchBalance(account, credentials)).rejects.toThrow("Aggregator balance request failed.");
      expect(sourceAuthorization).toBe("Bearer fixture-api-key");
      expect(JSON.parse(sourceBody)).toMatchObject({ credential: credentials });
      expect(destinationCalls).toBe(0);
    } finally { await Promise.all([close(destination), ...(source ? [close(source)] : [])]); }
  });
  it("does not read or expose malicious provider error bodies", async () => {
    const text = vi.fn(async () => "private-provider-echo fixture-api-key fixture-transient-secret");
    const gateway = new HttpAggregatorTravelProviderGateway({ ...config, fetchImpl: async () => ({ ok: false, status: 502, text }) });
    await expect(gateway.fetchBalance(account, credentials)).rejects.toThrow("Aggregator balance request failed (HTTP 502).");
    expect(text).not.toHaveBeenCalled();
  });
  it.each(["private-provider-echo", "null", "[]", '{"points":9007199254740992}', '{"points":-1}'])("rejects malformed/unsafe responses without private details: %s", async body => {
    const gateway = new HttpAggregatorTravelProviderGateway({ ...config, fetchImpl: async () => new Response(body) });
    await expect(gateway.fetchBalance(account, credentials)).rejects.toThrow(/Aggregator returned an invalid balance/);
    try { await gateway.fetchBalance(account, credentials); } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("private-provider-echo");
      expect(error).not.toHaveProperty("cause");
    }
  });
  it("hides thrown transport details without retaining a private cause", async () => {
    const gateway = new HttpAggregatorTravelProviderGateway({ ...config, fetchImpl: async () => { throw new Error("private provider credentials fixture-secret"); } });
    await expect(gateway.fetchBalance(account, credentials)).rejects.toEqual(new Error("Aggregator balance request failed."));
  });
  it("cancels real response streaming once the 32 KiB byte bound is exceeded", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(32 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel });
    const gateway = new HttpAggregatorTravelProviderGateway({ ...config, fetchImpl: async () => new Response(stream) });
    await expect(gateway.fetchBalance(account, null)).rejects.toThrow("Aggregator returned an invalid balance response.");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("bounds injected text-only responses by UTF-8 bytes", async () => {
    const gateway = new HttpAggregatorTravelProviderGateway({ ...config, fetchImpl: async () => ({ ok: true, status: 200, text: async () => `{"points":1,"padding":"${"旅".repeat(11000)}"}` }) });
    await expect(gateway.fetchBalance(account, null)).rejects.toThrow("Aggregator returned an invalid balance response.");
  });
});
