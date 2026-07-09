import {
  InvalidScrapeUrlError,
  ScrapeFailedError,
} from "../../domain/errors";
import {
  type DealCandidate,
  type DealKind,
} from "../../domain/loyalty/deals";
import { findProvider } from "../../domain/loyalty/provider";
import type { Clock, PageScraper } from "../ports";
import { systemClock } from "../ports";

export interface IngestDealPageInput {
  readonly url: string;
  /** Optional override when the page doesn't name a catalog provider. */
  readonly providerId?: string | null;
}

export interface IngestDealPageResult {
  readonly pageTitle: string;
  readonly deals: DealCandidate[];
  readonly markdownExcerpt: string;
}

function assertHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidScrapeUrlError();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidScrapeUrlError();
  }
  return parsed.toString();
}

/**
 * Scrapes a deal / award-chart page and extracts lightweight deal candidates
 * via heuristics on the markdown. The LLM assistant can refine these later;
 * this use case stays deterministic and testable.
 */
export class IngestDealPage {
  constructor(
    private readonly scraper: PageScraper,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(input: IngestDealPageInput): Promise<IngestDealPageResult> {
    const url = assertHttpUrl(input.url.trim());
    let page;
    try {
      page = await this.scraper.scrape(url);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "unknown scrape error";
      throw new ScrapeFailedError(reason);
    }

    const deals = extractDealsFromMarkdown(page.markdown, page.url, {
      providerId: input.providerId ?? null,
      now: this.clock.now(),
    });

    return {
      pageTitle: page.title,
      deals,
      markdownExcerpt: page.markdown.slice(0, 1200),
    };
  }
}

function extractDealsFromMarkdown(
  markdown: string,
  sourceUrl: string,
  opts: { providerId: string | null; now: Date },
): DealCandidate[] {
  const deals: DealCandidate[] = [];
  const lines = markdown.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const pointCash =
    /(\d{1,3}(?:,\d{3})*|\d+\.?\d*\s*k)\s*(?:points?|miles?|pts\.?).*?(?:\$|usd\s*)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i;
  const cashPoint =
    /(?:\$|usd\s*)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?).*?(\d{1,3}(?:,\d{3})*|\d+\.?\d*\s*k)\s*(?:points?|miles?|pts\.?)/i;

  let idx = 0;
  for (const line of lines.slice(0, 80)) {
    let points: number | null = null;
    let cashCents: number | null = null;

    const m1 = line.match(pointCash);
    if (m1) {
      points = parsePoints(m1[1]!);
      cashCents = Math.round(parseFloat(m1[2]!.replace(/,/g, "")) * 100);
    } else {
      const m2 = line.match(cashPoint);
      if (m2) {
        cashCents = Math.round(parseFloat(m2[1]!.replace(/,/g, "")) * 100);
        points = parsePoints(m2[2]!);
      }
    }

    if (points == null || points <= 0) continue;

    const providerId =
      opts.providerId ?? detectProviderId(line) ?? detectProviderId(markdown);
    const kind: DealKind = "scraped";
    idx += 1;
    deals.push({
      id: `scraped-${opts.now.getTime()}-${idx}`,
      kind,
      title: truncate(line.replace(/^#+\s*/, ""), 100),
      summary: truncate(line, 240),
      providerId,
      pointsCost: points,
      cashEquivalentCents: cashCents,
      sourceUrl,
      transferFromProviderId: null,
    });

    if (deals.length >= 5) break;
  }

  if (deals.length === 0) {
    deals.push({
      id: `scraped-${opts.now.getTime()}-page`,
      kind: "scraped",
      title: truncate(lines[0] ?? "Scraped deal page", 100),
      summary:
        "Could not parse structured point/cash pairs — open the source or ask the assistant to summarize.",
      providerId: opts.providerId,
      pointsCost: null,
      cashEquivalentCents: null,
      sourceUrl,
      transferFromProviderId: null,
    });
  }

  return deals;
}

function parsePoints(raw: string): number {
  const cleaned = raw.trim().toLowerCase().replace(/,/g, "");
  if (cleaned.endsWith("k")) {
    return Math.round(parseFloat(cleaned.slice(0, -1)) * 1000);
  }
  return Math.round(parseFloat(cleaned));
}

function detectProviderId(text: string): string | null {
  const lower = text.toLowerCase();
  const needles: Array<[string, string]> = [
    ["hyatt", "hyatt"],
    ["hilton", "hilton"],
    ["marriott", "marriott"],
    ["united", "united"],
    ["delta", "delta"],
    ["american", "american"],
    ["amtrak", "amtrak"],
    ["chase", "chase-ultimate-rewards"],
    ["amex", "amex-membership-rewards"],
    ["bilt", "bilt"],
  ];
  for (const [needle, id] of needles) {
    if (lower.includes(needle) && findProvider(id)) return id;
  }
  return null;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
