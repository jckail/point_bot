import { upstreamBaseUrl, boundedUpstreamJson, discardUpstreamBody } from "../http/upstream-transport";

import type { PageScraper, ScrapedPage } from "../../application/ports";

export interface FirecrawlConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

/**
 * Firecrawl Cloud / self-hosted adapter.
 * @see https://docs.firecrawl.dev
 */
export class FirecrawlPageScraper implements PageScraper {
  private readonly baseUrl: string;

  constructor(private readonly config: FirecrawlConfig) {
    this.baseUrl = upstreamBaseUrl(config.baseUrl ?? "https://api.firecrawl.dev");
  }

  async scrape(url: string): Promise<ScrapedPage> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/scrape`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      });
      if (!response.ok) { await discardUpstreamBody(response); throw new Error(); }
      const payload = await boundedUpstreamJson(response, 1024 * 1024);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
      const page = payload as { success?: unknown; data?: { markdown?: unknown; metadata?: { title?: unknown; sourceURL?: unknown } } };
      if (page.success === false || typeof page.data?.markdown !== "string" || !page.data.markdown.trim()) throw new Error();
      return {
        url: typeof page.data.metadata?.sourceURL === "string" ? page.data.metadata.sourceURL : url,
        title: typeof page.data.metadata?.title === "string" ? page.data.metadata.title : url,
        markdown: page.data.markdown.trim(), fetchedAt: new Date(),
      };
    } catch { throw new Error("Could not load the page from the scrape provider. Retry later."); }
  }
}

/**
 * Offline / demo scraper. Recognizes a few well-known demo URLs and otherwise
 * returns a synthetic award-chart snippet so ingest + ranking still work
 * without Firecrawl credentials.
 */
export class StubPageScraper implements PageScraper {
  async scrape(url: string): Promise<ScrapedPage> {
    const lower = url.toLowerCase();
    let title = "Demo deal page";
    let markdown = "";

    if (lower.includes("hyatt")) {
      title = "World of Hyatt award chart (demo)";
      markdown = [
        "# World of Hyatt award chart",
        "",
        "Off-peak Category 1 standard rooms from 3,500 points (~$180 cash).",
        "Peak Category 4 often 25,000 points for resorts listing at $450.",
        "Transfer from Chase Ultimate Rewards at 1:1; watch for 30% bonuses.",
      ].join("\n");
    } else if (lower.includes("united") || lower.includes("mileageplus")) {
      title = "United MileagePlus saver awards (demo)";
      markdown = [
        "# United Saver awards",
        "",
        "Domestic saver one-ways around 10,000 miles when space opens (~$220).",
        "Partner awards vary; 70,000 miles for some long-haul business savers (~$2,400).",
      ].join("\n");
    } else if (lower.includes("hilton")) {
      title = "Hilton Honors go wild (demo)";
      markdown = [
        "# Hilton peak weekend",
        "",
        "80,000 points for a resort night often priced at $550 cash.",
        "Amex Membership Rewards transfer 1→2 Hilton points.",
      ].join("\n");
    } else {
      title = `Scraped: ${url}`;
      markdown = [
        `# Deal page`,
        "",
        `Source: ${url}`,
        "",
        "Sample redemption: 50,000 points for a $750 hotel night.",
        "Alternate: 12,500 miles covering a $280 flight.",
        "",
        "_Stub scraper — set FIRECRAWL_API_KEY for live extraction._",
      ].join("\n");
    }

    return {
      url,
      title,
      markdown,
      fetchedAt: new Date(),
    };
  }
}
