import {
  InvalidScrapeUrlError,
  ScrapeFailedError,
} from "../../domain/errors";
import {
  type DealCandidate,
  type DealKind,
} from "../../domain/loyalty/deals";
import {
  findProvider,
  parseProviderId,
  type ProviderId,
} from "../../domain/loyalty/provider";
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
      providerId:
        input.providerId == null ? null : parseProviderId(input.providerId),
      now: this.clock.now(),
    });

    return {
      pageTitle: page.title,
      deals,
      markdownExcerpt: page.markdown.slice(0, 1200),
    };
  }
}

/** Conservative line guard: cash DTOs are USD, never an inferred foreign conversion. */
function hasForeignCashCurrency(line: string): boolean {
  const foreignDollarPrefix = [...line.matchAll(/(?<!\w)([a-z]+)\$/gi)].some(match => !["US", "USD"].includes(match[1]!.toUpperCase()));
  return foreignDollarPrefix || /\b(?:CAD|AUD|NZD|HKD|SGD|TWD|PHP|IDR|VND|EUR|GBP|JPY|CHF|CNY|RMB|KRW|INR|THB|AED|MXN|BRL|ZAR)\b/i.test(line)
    || /(?<!\w)(?:CA|C|AU|A|NZ|HK|SG|S)\s*\$/i.test(line)
    || /[€£¥₹₩]/u.test(line)
    || /\b(?:Canadian|Australian|New Zealand|Hong Kong|Singapore)\s+dollars?\b/i.test(line);
}

function extractDealsFromMarkdown(
  markdown: string,
  sourceUrl: string,
  opts: { providerId: ProviderId | null; now: Date },
): DealCandidate[] {
  const deals: DealCandidate[] = [];
  const lines = markdown.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Capture whole numeric tokens before validating grammar; never numeric fragments.
  const numeric = String.raw`\d(?:[\d,]*\d)?(?:\.\d+)?`;
  const pointsToken = String.raw`(?<![\w.,+-])(${numeric}\s*k?)\s*(?:points?|miles?|pts\.?)(?!\w)`;
  const foreignPageCurrency = lines.some(line =>
    /\b(?:prices?|rates?|amounts?|costs?|fares?)\s+(?:(?:are|shown|displayed|quoted|listed|denominated)\s+)*(?:in|as)\b|\bcurrency\s*[:=]/i.test(line)
      && hasForeignCashCurrency(line));
  // A foreign page declaration removes the bare-dollar assumption. Only the
  // selected cash token's explicit US/USD prefix or USD suffix can override it.
  const currencyToken = foreignPageCurrency
    ? String.raw`(?:\bUSD\s*\$?|\bUS\s*\$|\$(?=\s*${numeric}\s*USD\b))`
    : String.raw`(?:\bUSD\s*\$?|\bUS\s*\$|\$)`;
  const cashToken = String.raw`${currencyToken}\s*(${numeric})(?!\w|[.,][\d.,])`;
  const pointCash = new RegExp(`${pointsToken}.*?${cashToken}`, "i");
  const cashPoint = new RegExp(`${cashToken}.*?${pointsToken}`, "i");

  let idx = 0;
  for (const line of lines.slice(0, 80)) {
    // Preserve legacy bare-$ and explicit USD/US$ parsing. Foreign or mixed
    // currency lines remain unstructured rather than publishing fabricated USD.
    if (hasForeignCashCurrency(line)) continue;
    let points: number | null = null;
    let cashCents: number | null = null;

    const m1 = line.match(pointCash);
    if (m1) {
      points = parsePoints(m1[1]!);
      cashCents = parseScaledInteger(m1[2]!, 2);
    } else {
      const m2 = line.match(cashPoint);
      if (m2) {
        cashCents = parseScaledInteger(m2[1]!, 2);
        points = parsePoints(m2[2]!);
      }
    }

    if (points == null || points <= 0 || cashCents == null) continue;

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

/** Exact decimal scaling rejects fractional units and unsafe DTO integers. */
function parseScaledInteger(raw: string, decimals: number): number | null {
  // Safe DTO integers have at most 16 digits; bound parsing of remote tokens.
  if (raw.length > 64) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
  const [whole = "", fraction = ""] = raw.replace(/,/g, "").split(".");
  if (fraction.length > decimals) return null;
  const value = BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function parsePoints(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase();
  return cleaned.endsWith("k")
    ? parseScaledInteger(cleaned.slice(0, -1).trim(), 3)
    : parseScaledInteger(cleaned, 0);
}

function detectProviderId(text: string): ProviderId | null {
  const lower = text.toLowerCase();
  const needles: Array<[string, ProviderId]> = [
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
