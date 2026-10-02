import { upstreamBaseUrl, boundedUpstreamJson, discardUpstreamBody } from "../http/upstream-transport";

import { z } from "zod";

import type { AwardAvailabilitySource } from "../../application/ports";
import {
  AWARD_CABINS,
  normalizeAwardQuery,
  type AwardOption,
  type AwardSearchQuery,
  type AwardSearchResult,
} from "../../domain/loyalty/award-availability";
import { isSupportedProvider } from "../../domain/loyalty/provider";

/** Default adapter: no award search is configured, so nothing is ever claimed. */
export class StubAwardAvailabilitySource implements AwardAvailabilitySource {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async searchAwards(): Promise<AwardSearchResult> {
    return {
      status: "not_configured",
      options: [],
      checkedAt: this.now(),
      message:
        "Award availability search is not configured (set AWARD_SEARCH_API_URL and AWARD_SEARCH_API_KEY). Availability is NOT verified.",
    };
  }
}

export interface HttpAwardAvailabilityOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

const responseSchema = z.object({
  options: z.array(
    z.object({
      program: z.string().max(200),
      carrier: z.string().max(200).nullish(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      cabin: z.enum(AWARD_CABINS),
      points: z.number().int().positive(),
      taxes_cents: z.number().int().nonnegative().nullish(),
      seats: z.number().int().nonnegative().nullish(),
    }),
  ).max(1000),
});

/**
 * Skeleton adapter for a generic award-search HTTP API. Contract (our own,
 * to be mapped by a gateway in front of the real data vendor):
 *   GET {base}/awards?origin=&destination=&from=&to=&cabin=
 *   Authorization: Bearer <key>
 *   -> { options: [{ program, carrier?, date, cabin, points, taxes_cents?, seats? }] }
 * Unknown programs are dropped. Failures never throw.
 */
export class HttpAwardAvailabilitySource implements AwardAvailabilitySource {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly baseUrl: string;

  constructor(private readonly options: HttpAwardAvailabilityOptions) {
    this.baseUrl = upstreamBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private fail(message: string): AwardSearchResult {
    return { status: "error", options: [], checkedAt: this.now(), message };
  }

  async searchAwards(raw: AwardSearchQuery): Promise<AwardSearchResult> {
    const normalized = normalizeAwardQuery(raw);
    if (!normalized.ok) return this.fail(normalized.reason);
    const q = normalized.query;
    const url = new URL("/awards", this.baseUrl);
    url.searchParams.set("origin", q.origin);
    url.searchParams.set("destination", q.destination);
    url.searchParams.set("from", q.dateFrom);
    url.searchParams.set("to", q.dateTo);
    url.searchParams.set("cabin", q.cabin);

    let body: unknown;
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
        redirect: "error",
      });
      if (!response.ok) {
        await discardUpstreamBody(response);
        return this.fail(`Award search backend returned HTTP ${response.status}`);
      }
      body = await boundedUpstreamJson(response, 256 * 1024);
    } catch {
      return this.fail("Award search request failed. Retry later; availability is not verified.");
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      return this.fail("Award search backend returned an unexpected payload");
    }
    const options: AwardOption[] = parsed.data.options
      .filter((o) => isSupportedProvider(o.program))
      .map((o) => ({
        programId: o.program,
        carrier: o.carrier ?? null,
        date: o.date,
        cabin: o.cabin,
        pointsCost: o.points,
        taxesCents: o.taxes_cents ?? null,
        seats: o.seats ?? null,
      }))
      .sort(
        (a, b) =>
          a.pointsCost - b.pointsCost ||
          a.date.localeCompare(b.date) ||
          a.programId.localeCompare(b.programId),
      );
    return { status: "ok", options, checkedAt: this.now(), message: null };
  }
}
