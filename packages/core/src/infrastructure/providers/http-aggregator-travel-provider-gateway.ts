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
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const defaultFetch: AggregatorFetch = (url, init) =>
  fetch(url, init as RequestInit);

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
 * configuration and registered ahead of the simulated gateway in the composite,
 * so real providers win and everything else falls back to the simulation.
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
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
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
    const response = await this.fetchImpl(`${this.baseUrl}/v1/balance`, {
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
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Aggregator balance fetch failed for "${account.providerId}" (${response.status}): ${body.slice(0, 200)}`,
      );
    }

    const payload = JSON.parse(await response.text()) as { points?: unknown };
    const points = payload.points;
    if (typeof points !== "number" || !Number.isFinite(points) || points < 0) {
      throw new Error(
        `Aggregator returned an invalid balance for "${account.providerId}"`,
      );
    }
    return { points: Math.round(points) };
  }
}
