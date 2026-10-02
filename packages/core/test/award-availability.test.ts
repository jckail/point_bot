import { describe, expect, it } from "vitest";

import {
  HttpAwardAvailabilitySource,
  StubAwardAvailabilitySource,
} from "../src/infrastructure/award-search/award-availability-sources";
import { selectAwardAvailability } from "../src/composition/adapters";
import { normalizeAwardQuery } from "../src/domain/loyalty/award-availability";

const now = new Date("2026-10-15T00:00:00Z");
const query = { origin: "jfk", destination: "nrt", dateFrom: "2026-12-01", dateTo: "2026-12-07", cabin: "business" as const };

function fakeFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const impl = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("StubAwardAvailabilitySource", () => {
  it("reports not_configured with no options, never availability", async () => {
    const result = await new StubAwardAvailabilitySource(() => now).searchAwards();
    expect(result).toMatchObject({ status: "not_configured", options: [] });
    expect(result.message).toMatch(/not configured/);
    expect(result.message).toMatch(/NOT verified/);
  });
});

describe("HttpAwardAvailabilitySource", () => {
  it("sends a normalized authenticated request and maps, filters and sorts options", async () => {
    const { impl, calls } = fakeFetch(() =>
      Response.json({
        options: [
          { program: "air-canada-aeroplan", carrier: "NH", date: "2026-12-04", cabin: "business", points: 90000, taxes_cents: 5600, seats: 2 },
          { program: "not-a-program", date: "2026-12-04", cabin: "business", points: 1 },
          { program: "virgin-atlantic-flying-club", date: "2026-12-02", cabin: "business", points: 60000 },
        ],
      }),
    );
    const source = new HttpAwardAvailabilitySource({ baseUrl: "https://awards.example.com", apiKey: "k3y", fetch: impl, now: () => now });
    const result = await source.searchAwards(query);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe("/awards");
    expect(calls[0]!.url.searchParams.get("origin")).toBe("JFK");
    expect(calls[0]!.url.searchParams.get("destination")).toBe("NRT");
    expect(calls[0]!.url.searchParams.get("from")).toBe("2026-12-01");
    expect(calls[0]!.url.searchParams.get("cabin")).toBe("business");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k3y");
    expect(result.status).toBe("ok");
    expect(result.options.map((o) => o.programId)).toEqual(["virgin-atlantic-flying-club", "air-canada-aeroplan"]);
    expect(result.options[1]).toMatchObject({ carrier: "NH", taxesCents: 5600, seats: 2, pointsCost: 90000 });
    expect(result.options[0]).toMatchObject({ carrier: null, taxesCents: null, seats: null });
  });

  it("returns an ok result with no options when the backend finds none", async () => {
    const { impl } = fakeFetch(() => Response.json({ options: [] }));
    const result = await new HttpAwardAvailabilitySource({ baseUrl: "https://a.example", apiKey: "k", fetch: impl, now: () => now }).searchAwards(query);
    expect(result).toMatchObject({ status: "ok", options: [] });
  });

  it.each([
    ["HTTP error", () => new Response("no", { status: 502 }), /HTTP 502/],
    ["malformed JSON", () => new Response("<html>", { status: 200 }), /request failed/],
    ["wrong shape", () => Response.json({ nope: true }), /unexpected payload/],
    ["bad cabin", () => Response.json({ options: [{ program: "united", date: "2026-12-01", cabin: "steerage", points: 5 }] }), /unexpected payload/],
  ])("maps %s to status error without throwing", async (_n, handler, message) => {
    const { impl } = fakeFetch(handler);
    const result = await new HttpAwardAvailabilitySource({ baseUrl: "https://a.example", apiKey: "k", fetch: impl, now: () => now }).searchAwards(query);
    expect(result.status).toBe("error");
    expect(result.options).toEqual([]);
    expect(result.message).toMatch(message);
  });

  it("maps network failures to error and never leaks the api key", async () => {
    const impl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const result = await new HttpAwardAvailabilitySource({ baseUrl: "https://a.example", apiKey: "sekret", fetch: impl, now: () => now }).searchAwards(query);
    expect(result.status).toBe("error");
    expect(result.message).not.toContain("ECONNRESET");
    expect(result.message).toContain("Retry later");
    expect(JSON.stringify(result)).not.toContain("sekret");
  });

  it("rejects invalid queries before any network call", async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ options: [] }));
    const source = new HttpAwardAvailabilitySource({ baseUrl: "https://a.example", apiKey: "k", fetch: impl });
    for (const bad of [
      { ...query, origin: "NEWYORK" },
      { ...query, dateTo: "2026-11-01" },
      { ...query, dateFrom: "12/01/2026" },
      { ...query, cabin: "couch" as never },
    ]) {
      expect((await source.searchAwards(bad)).status).toBe("error");
    }
    expect(calls).toHaveLength(0);
  });
});

describe("selectAwardAvailability", () => {
  it("is the honest stub unless both URL and key are set", () => {
    expect(selectAwardAvailability({})).toBeInstanceOf(StubAwardAvailabilitySource);
    expect(selectAwardAvailability({ AWARD_SEARCH_API_URL: "https://x" })).toBeInstanceOf(StubAwardAvailabilitySource);
    expect(selectAwardAvailability({ AWARD_SEARCH_API_KEY: "k" })).toBeInstanceOf(StubAwardAvailabilitySource);
    expect(
      selectAwardAvailability({ AWARD_SEARCH_API_URL: "https://x", AWARD_SEARCH_API_KEY: "k" }),
    ).toBeInstanceOf(HttpAwardAvailabilitySource);
  });
});

describe("normalizeAwardQuery", () => {
  it("upper-cases IATA codes", () => {
    const r = normalizeAwardQuery(query);
    expect(r.ok && r.query.origin).toBe("JFK");
  });
});
