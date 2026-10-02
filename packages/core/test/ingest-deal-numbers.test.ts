import { describe, expect, it, vi } from "vitest";
import { CheckAwardWatches } from "../src/application/loyalty/award-watches";
import { createAwardWatch } from "../src/domain/loyalty/award-watch";
import { InMemoryAwardWatchRepository } from "./fakes";
import { asUserId } from "./ids";
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

describe("scraped signed amounts", () => {
  it.each(["-$300", "−$300", "- US$300", "− US $300", "-USD 300", "−USD$300", "USD -300", "USD −300", "USD$ -300", "US$ −300", "$ −300", "− $300 USD", "($300)", "(USD 300)"])("keeps signed or accounting cash unstructured in both layouts: %s", async cash => {
    for (const line of [`Hyatt 10,000 points or ${cash}`, `Hyatt ${cash} or 10,000 points`]) {
      expect((await ingest(line)).deals[0]).toMatchObject({ pointsCost: null, cashEquivalentCents: null });
    }
  });
  it.each(["−10,000 points", "− 10,000 points", "- 10,000 points", "−12.5k miles"])("never extracts an unsigned fragment of signed points: %s", async points => {
    for (const line of [`Hyatt ${points} or $300`, `Hyatt $300 or ${points}`]) {
      expect((await ingest(line)).deals[0]).toMatchObject({ pointsCost: null, cashEquivalentCents: null });
    }
  });
  it("preserves unsigned values with prose separators and independent valid lines", async () => {
    expect((await ingest("Hyatt 10,000 points - equivalent to $300")).deals[0]).toMatchObject({ pointsCost: 10000, cashEquivalentCents: 30000 });
    expect((await ingest("Hyatt $300 - equivalent to 10,000 points")).deals[0]).toMatchObject({ pointsCost: 10000, cashEquivalentCents: 30000 });
    expect((await ingest("Hyatt 10,000 points or $300; unrelated adjustment -$25")).deals[0]).toMatchObject({ pointsCost: 10000, cashEquivalentCents: 30000 });
    const result = await ingest("Hyatt 10,000 points or −US$500\nHyatt 20,000 points or USD 400");
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]).toMatchObject({ pointsCost: 20000, cashEquivalentCents: 40000 });
  });
  it("never publishes or raises a watch best from negative cash, while accepting a positive hit", async () => {
    const repo = new InMemoryAwardWatchRepository();
    const watch = createAwardWatch({ userId: asUserId("signed-cash"), url: "https://synthetic.example/deals", label: "Signed cash", minCentsPerPoint: 2.5, now: new Date("2026-10-02T12:00:00Z") });
    await repo.insert(watch);
    let markdown = "Hyatt 10,000 points or -$500";
    let now = new Date("2026-10-02T12:00:00Z");
    const clock = { now: () => now };
    const page = new IngestDealPage({ scrape: async url => ({ url, title: "Synthetic", markdown, fetchedAt: now }) }, clock);
    const publish = vi.fn(async () => {});
    const check = new CheckAwardWatches(repo, page, clock, { unitOfWork: { atomic: false, run: work => work() }, publisher: { publish } });
    expect(await check.execute()).toEqual({ checked: 1, failed: 0, hits: [] });
    expect(await repo.findById(watch.id)).toMatchObject({ bestSeenCentsPerPoint: null, lastNotifiedAt: null, lastCheckedAt: now });
    expect(publish).not.toHaveBeenCalled();
    markdown = "Hyatt USD 300 or 10,000 points";
    now = new Date("2026-10-02T12:01:00Z");
    expect((await check.execute()).hits).toHaveLength(1);
    expect(publish).toHaveBeenCalledWith([expect.objectContaining({ type: "watch.triggered" })]);
    const notifiedAt = now;
    markdown = "Hyatt −US$500 or 10,000 points";
    now = new Date("2026-10-02T12:02:00Z");
    expect(await check.execute()).toEqual({ checked: 1, failed: 0, hits: [] });
    expect(await repo.findById(watch.id)).toMatchObject({ bestSeenCentsPerPoint: 3, lastNotifiedAt: notifiedAt, lastCheckedAt: now });
    expect(publish).toHaveBeenCalledOnce();
  });
});

describe("scraped program identity", () => {
  it.each(["American Express Membership Rewards", "American Express: Membership Rewards", "Amex Membership Rewards", "AMEX"])("keeps explicit card labels out of American Airlines: %s", async label => {
    expect((await ingest(`${label}: 10,000 points or $300`)).deals[0]).toMatchObject({ providerId: "amex-membership-rewards", pointsCost: 10000, cashEquivalentCents: 30000 });
  });
  it.each(["American AAdvantage", "American Airlines"])("preserves American airline labels: %s", async label => {
    expect((await ingest(`${label}: 10,000 miles or $300`)).deals[0]?.providerId).toBe("american");
  });
  it("does not infer Membership Rewards or airline miles from American Express cash back", async () => {
    expect((await ingest("American Express cash back: 10,000 points or $300")).deals[0]?.providerId).toBeNull();
  });
  it.each([
    ["Hilton: 80,000 points or $550; transfer Amex points to Hilton", "hilton"],
    ["Hyatt: 10,000 points or $300. American Express Membership Rewards article.", "hyatt"],
    ["American AAdvantage: 10,000 miles or $300; transfer Amex points", "american"],
  ])("preserves an explicit redemption program despite card context: %s", async (line, providerId) => {
    expect((await ingest(line)).deals[0]?.providerId).toBe(providerId);
  });
  it.each(["Amex cash back", "AMEX cashback", "Amex cash-back"])("does not manufacture a Membership Rewards target from %s", async label => {
    expect((await ingest(`${label}: 10,000 points or $300`)).deals[0]?.providerId).toBeNull();
  });
});


describe("scraped cash currency provenance", () => {
  const foreign = ["C$300", "CA$300", "A$300", "AU$300", "NZ$300", "HK$300", "SG$300", "S$300", "NT$300", "R$300", "XYZ$300", "TWD $300", "$300 TWD",
    "$300 CAD", "$300 AUD", "$300 NZD", "EUR 300", "€300", "£300", "¥300", "300 Canadian dollars"];
  it.each(foreign)("keeps foreign cash unstructured in both token orders: %s", async cash => {
    for (const line of [`Hyatt 10,000 points or ${cash}`, `Hyatt ${cash} or 10,000 points`]) {
      expect((await ingest(line)).deals[0]).toMatchObject({ pointsCost: null, cashEquivalentCents: null });
    }
  });
  it.each(["$300", "USD 300", "US$300", "USD$300", "$300 USD"])("preserves USD and legacy bare-dollar claims: %s", async cash => {
    for (const line of [`Hyatt 10,000 points or ${cash}`, `Hyatt ${cash} or 10,000 points`]) {
      expect((await ingest(line)).deals[0]).toMatchObject({ pointsCost: 10000, cashEquivalentCents: 30000 });
    }
  });
  it("refuses mixed currencies rather than picking an unrelated USD amount", async () => {
    expect((await ingest("Hyatt 10,000 points or C$300 (USD 200)")).deals[0]).toMatchObject({ pointsCost: null, cashEquivalentCents: null });
    expect((await ingest("Hyatt USD 200 / AUD 300 for 10,000 points")).deals[0]).toMatchObject({ pointsCost: null, cashEquivalentCents: null });
  });
  it("does not let one foreign line discard an independently valid USD line", async () => {
    const result = await ingest("Hyatt 10,000 points or C$300\nHyatt 20,000 points or US$400");
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]).toMatchObject({ pointsCost: 20000, cashEquivalentCents: 40000 });
  });
  it.each(["Prices quoted in CAD", "All prices are displayed in TWD", "Currency: AUD"])("refuses bare-dollar claims under a foreign page declaration: %s", async declaration => {
    for (const line of ["Hyatt 25000 points for $1500", "Hyatt $1500 for 25000 points"]) {
      expect((await ingest(`${declaration}\n${line}`)).deals[0]).toMatchObject({ pointsCost: null, cashEquivalentCents: null });
    }
  });
  it.each(["USD 300", "US$300", "USD$300", "$300 USD"])("permits an explicitly USD cash token on a foreign-declared page: %s", async cash => {
    for (const line of [`Hyatt 10000 points for ${cash}`, `Hyatt ${cash} for 10000 points`]) {
      expect((await ingest(`Prices quoted in CAD\n${line}`)).deals[0]).toMatchObject({ pointsCost: 10000, cashEquivalentCents: 30000 });
    }
  });
  it("does not let an unrelated USD mention relabel a bare-dollar claim", async () => {
    expect((await ingest("Prices quoted in CAD\nHyatt 10000 points for $300; US dollars accepted")).deals[0]).toMatchObject({ pointsCost: null, cashEquivalentCents: null });
  });
  it.each(["Hyatt 10,000 points or C$300", "Prices quoted in CAD\nHyatt 10,000 points or $300", "Hyatt 10,000 points or TWD $300", "Hyatt 10,000 points or R$300"])("blocks a false foreign-cash watch hit/state: %s", async markdown => {
    const repo = new InMemoryAwardWatchRepository();
    const watch = createAwardWatch({ userId: asUserId("synthetic"), url: "https://synthetic.example/deals", label: "Foreign cash", minCentsPerPoint: 2.5 });
    await repo.insert(watch);
    const ingestPage = new IngestDealPage({ scrape: async url => ({ url, title: "Synthetic", markdown, fetchedAt: new Date(0) }) });
    const result = await new CheckAwardWatches(repo, ingestPage).execute();
    expect(result).toEqual({ checked: 1, failed: 0, hits: [] });
    const after = await repo.findById(watch.id);
    expect(after?.bestSeenCentsPerPoint).toBeNull();
    expect(after?.lastNotifiedAt).toBeNull();
    expect(after?.lastCheckedAt).toBeInstanceOf(Date);
  });
});
