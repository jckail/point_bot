import type { LoyaltyAccount } from "../../domain/loyalty/loyalty-account";
import type {
  ProviderBalance,
  ProviderCredential,
  TravelProviderGateway,
} from "../../application/ports";

/** Minimal fetch shape so the adapter is unit-testable without a network. */
export type AggregatorFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
    redirect: "error";
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
}>;

const defaultFetch: AggregatorFetch = (url, init) =>
  fetch(url, init);

export interface HttpAggregatorConfig {
  /** Aggregator API base URL, e.g. https://api.aggregator.example */
  readonly baseUrl: string;
  readonly apiKey: string;
  /**
   * Provider ids this aggregator serves. Omit to let it attempt any provider
   * (useful for a broad aggregator); set it to scope the adapter to the
   * programs the vendor actually supports.
   */
  readonly supportedProviderIds?: readonly string[];
  readonly fetchImpl?: AggregatorFetch;
  readonly timeoutMs?: number;
}

/**
 * Real balance gateway backed by a loyalty-data aggregator's HTTP API — one
 * adapter to cover the long tail of programs (roadmap Phase 3). Activated by
 * configuration and registered first for its supported providers. Simulation
 * fallback exists only when the host explicitly enables a demo composition.
 *
 * Aggregator wire contract (vendor side):
 *   POST {baseUrl}/v1/balance
 *   Authorization: Bearer {apiKey}
 *   { "providerId", "membershipNumber", "credential"?: { username, secret } }
 *   → 200 { "points": number }
 *
 * Credentials, when supplied by the calling surface, are forwarded for
 * one-time use and never persisted here.
 */
export class HttpAggregatorTravelProviderGateway
  implements TravelProviderGateway
{
  private readonly baseUrl: string;
  private readonly fetchImpl: AggregatorFetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: HttpAggregatorConfig) {
    let url: URL;
    try { url = new URL(config.baseUrl); } catch { throw new Error("Aggregator URL is invalid."); }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (/[\s\\]/.test(config.baseUrl) || config.baseUrl.includes("?") || config.baseUrl.includes("#") ||
        url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
      throw new Error("Aggregator URL requires HTTPS without credentials, query or fragment; HTTP is allowed only on loopback.");
    }
    this.baseUrl = url.href.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? defaultFetch;
    this.timeoutMs = config.timeoutMs ?? 20_000;
  }

  supports(providerId: string): boolean {
    return (
      !this.config.supportedProviderIds ||
      this.config.supportedProviderIds.includes(providerId)
    );
  }

  async fetchBalance(
    account: LoyaltyAccount,
    credential: ProviderCredential | null,
  ): Promise<ProviderBalance> {
    let response: Awaited<ReturnType<AggregatorFetch>>;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/balance`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId: account.providerId,
          membershipNumber: account.membershipNumber,
          ...(credential
            ? { credential: { username: credential.username, secret: credential.secret } }
            : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
    } catch { throw new Error("Aggregator balance request failed."); }

    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* No private transport errors. */ }
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? ` (HTTP ${response.status})` : "";
      throw new Error(`Aggregator balance request failed${status}.`);
    }

    let payload: unknown;
    try { payload = JSON.parse(await boundedResponseText(response)); }
    catch { throw new Error("Aggregator returned an invalid balance response."); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Aggregator returned an invalid balance response.");
    }
    const points = (payload as { points?: unknown }).points;
    if (typeof points !== "number" || !Number.isFinite(points) || points < 0 || !Number.isSafeInteger(Math.round(points))) {
      throw new Error("Aggregator returned an invalid balance.");
    }
    return { points: Math.round(points) };
  }
}

const MAX_RESPONSE_BYTES = 32 * 1024;

/** Real fetch responses are read incrementally; injected text-only fixtures stay supported. */
async function boundedResponseText(response: Awaited<ReturnType<AggregatorFetch>>): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error("Response exceeds limit.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* Keep the fixed size failure. */ }
        throw new Error("Response exceeds limit.");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
