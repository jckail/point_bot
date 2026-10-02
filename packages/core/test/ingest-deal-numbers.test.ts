import { describe, expect, it } from "vitest";
import { IngestDealPage } from "../src/application/loyalty/ingest-deal-page";

async function ingest(markdown: string) {
  return new IngestDealPage({
    scrape: async (url) => ({ url, markdown, title: "Synthetic deal page", fetchedAt: new Date(0) }),
  }, { now: () => new Date(0) }).execute({ url: "https://synthetic.example/deals" });
}

describe("scraped deal numeric tokens", () => {
  it.each([
    ["Hyatt 12500 points for $1500", 12500, 150000],
    ["Hyatt $1500 buys 12500 points", 12500, 150000],
    ["Hyatt 25,000 points for $1,500.25", 25000, 150025],
    ["Hyatt 1,000 points for $123.4", 1000, 12340],
    ["Hyatt 12.5k points for USD 500", 12500, 50000],
    ["Hyatt $500 for 12.345 k miles", 12345, 50000],
    ["Hyatt 1000 pts. for $500.", 1000, 50000],
    ["Hyatt 9,007,199,254,740,991 points for $90,071,992,547,409.91", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ["Hyatt 1 point for $0.29", 1, 29],
    ["Hyatt 1 point for $0", 1, 0],
  ])("parses complete tokens: %s", async (line, points, cents) => {
    const result = await ingest(line);
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]).toMatchObject({ pointsCost: points, cashEquivalentCents: cents });
  });

  it.each([
    "Hyatt 12.5 points for $500", "Hyatt 12,50 points for $500",
    "Hyatt 12.3456k points for $500", "Hyatt 1000 points for $123.456",
    "Hyatt 1000 points for $1,50", "Hyatt 1000 points for $1..50",
    "Hyatt 1e3 points for $500", "Hyatt -1000 points for $500",
    "Hyatt 1000 points for $-500", "Hyatt 9,007,199,254,740,992 points for $500",
    "Hyatt 1000 points for $90,071,992,547,409.92",
    `Hyatt ${"9".repeat(100)}k points for $500`, "Hyatt 0 points for $500",
  ])("keeps malformed or unsafe tokens unstructured: %s", async (line) => {
    const result = await ingest(line);
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]).toMatchObject({ pointsCost: null, cashEquivalentCents: null });
  });
});
