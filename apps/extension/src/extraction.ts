/**
 * Pure, framework-free balance extraction. Given a page's hostname and visible
 * text, detect which loyalty provider the page belongs to and pull the balance
 * out of it — no DOM, no chrome APIs — so it can be unit-tested exhaustively.
 *
 * These are best-effort heuristics keyed on each program's balance wording;
 * they require balance context or an isolated unit value and refuse conflicting
 * readings or offers. Tune the patterns per provider over time.
 */

export interface ProviderPageRule {
  readonly providerId: string;
  /** Provider hosts; bank rules require an exact approved rewards hostname. */
  readonly hosts: readonly string[];
  readonly exactHosts?: boolean;
  /** Synthetic coverage does not establish live authenticated page compatibility. */
  readonly unverifiedLive?: boolean;
  readonly region?: "US";
  readonly unit?: "points" | "miles";
  /** Numeric unit patterns; conflicting readings are refused. */
  readonly patterns: readonly RegExp[];
}

function bankRule(providerId: string, hosts: readonly string[], program: string, unit: "points" | "miles",
  region?: "US"): ProviderPageRule {
  const balance = `(?:(?:available|current|total)(?:\\s+${unit})?(?:\\s+balance)?|(?:${unit}\\s+)?balance)`;
  const number = "([\\d,]+)";
  const end = "(?![A-Za-z0-9.,_+\\-−])";
  return { providerId, hosts, exactHosts: true, unverifiedLive: true, unit, ...(region ? { region } : {}),
    patterns: [
      new RegExp(`${program}\\s*(?:${unit}\\s*)?${balance}\\s*[:–-]?\\s*${number}(?:\\s*${unit})?${end}`, "i"),
      new RegExp(`${number}\\s*(?:${unit}\\s+)?${program}\\s*(?:${unit}\\s*)?${balance}\\b`, "i"),
      new RegExp(`${program}\\s+${unit}\\s*:?\\s*${number}(?:\\s*${unit})?\\s+${balance}\\b`, "i"),
    ] };
}

export const PROVIDER_PAGE_RULES: readonly ProviderPageRule[] = [
  {
    providerId: "united",
    hosts: ["united.com"],
    patterns: [/([\d,]+)\s*miles/i],
  },
  {
    providerId: "delta",
    hosts: ["delta.com"],
    patterns: [/([\d,]+)\s*miles/i],
  },
  {
    providerId: "american",
    hosts: ["aa.com"],
    patterns: [/([\d,]+)\s*(?:aadvantage\s*)?miles/i],
  },
  {
    providerId: "southwest-rapid-rewards",
    hosts: ["southwest.com"],
    patterns: [/([\d,]+)\s*(?:rapid\s*rewards\s*)?points/i],
  },
  {
    providerId: "marriott",
    hosts: ["marriott.com"],
    patterns: [/([\d,]+)\s*(?:bonvoy\s*)?points/i],
  },
  {
    providerId: "hyatt",
    hosts: ["hyatt.com"],
    patterns: [/([\d,]+)\s*points/i],
  },
  {
    providerId: "hilton",
    hosts: ["hilton.com"],
    patterns: [/([\d,]+)\s*points/i],
  },
  bankRule("chase-ultimate-rewards", ["ultimaterewardspoints.chase.com"], "(?:chase\\s+)?ultimate\\s+rewards(?:®|™)?", "points"),
  bankRule("amex-membership-rewards", ["global.americanexpress.com"], "(?:amex\\s+)?membership\\s+rewards(?:®|™)?", "points", "US"),
  bankRule("capital-one-miles", ["myrewards.capitalone.com"], "capital\\s+one(?:\\s+rewards)?", "miles"),
  bankRule("bilt", ["www.bilt.com", "www.biltrewards.com"], "bilt(?:\\s+rewards)?", "points"),
];

/** Hosts the content script should run on (for the manifest matches). */
export function providerHostGlobs(): string[] {
  return PROVIDER_PAGE_RULES.flatMap((rule) =>
    rule.hosts.map((host) => `https://${rule.exactHosts ? "" : "*."}${host}/*`),
  );
}

export function detectProvider(hostname: string): ProviderPageRule | null {
  const host = hostname.toLowerCase();
  return (
    PROVIDER_PAGE_RULES.find((rule) =>
      rule.hosts.some((h) => host === h || (!rule.exactHosts && host.endsWith(`.${h}`))),
    ) ?? null
  );
}

/** Parse "1,234,567" → 1234567; returns null for non-numbers. */
export function parsePoints(raw: string): number | null {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) return null;
  const digits = raw.replace(/,/g, "");
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

export function extractPointsWithRule(
  rule: ProviderPageRule,
  text: string,
): number | null {
  const candidates = new Set<number>();
  let hasBalanceContext = false;
  let hasOfferContext = false;
  for (const pattern of rule.patterns) {
    // Examine every reading, including later conflicting offers or balances.
    const all = new RegExp(pattern.source, "gi");
    for (const match of text.matchAll(all)) {
      const start = match.index ?? 0;
      const index = start + match[0].indexOf(match[1]!);
      const before = text.slice(Math.max(0, index - 120), index);
      const after = text.slice(start + match[0].length, start + match[0].length + 60);
      const numberSuffix = text.slice(index + match[1]!.length);
      if (rule.unit) {
        // Issuer names alone do not distinguish points from money or status.
        if (!new RegExp(`\\b${rule.unit}\\b`, "i").test(match[0])) continue;
        const explicitUnit = /^\s*(points?|miles?|dollars?|(?:bilt\s+)?cash(?:\s*back)?|usd|cad|gbp|aud|eur|%)(?=\s|$|[.,])/i.exec(numberSuffix)?.[1];
        if (explicitUnit && explicitUnit.toLowerCase() !== rule.unit) continue;
        if (/\b(?:status|qualifying|qualification|tier|progress|cash\s*back)\b[^\n.!?]{0,32}$/i.test(text.slice(Math.max(0, start - 120), start))) continue;
      }
      // A suffix of a decimal, negative, exponent or space-grouped value is
      // not a whole balance, even when the suffix itself is a safe integer.
      if (/[\p{L}\p{N}.,_+\-−]$/u.test(before) || /(?:\d|[+\-−])\s+$/.test(before)
        || /^[.,_+\-−\p{N}]/u.test(numberSuffix) || /^\s+\d/.test(numberSuffix)) continue;
      const points = match[1] ? parsePoints(match[1]) : null;
      if (points === null) continue;
      candidates.add(points);
      // Bank patterns themselves require the program plus a balance label.
      hasBalanceContext ||= Boolean(rule.exactHosts) || text.trim() === match[0].trim()
        || /\b(?:balance|(?:available|current|total)(?:\s+(?:points|miles))?|you\s+have|your\s+(?:bonvoy\s+)?points)\s*[:–-]?\s*$/i.test(before)
        || /^\s*(?:available|remaining|balance)\b/i.test(after);
      hasOfferContext ||= /\b(?:earn|redeem|bonus|welcome\s+offer|up\s+to|starting\s+at|from|spend|win)\b[^\n.!?]{0,32}$/i.test(before)
        || /\b(?:earn|redeem|bonus|welcome\s+offer|up\s+to|starting\s+at|from|spend|win)\b[^\n.!?]{0,32}$/i.test(text.slice(Math.max(0, start - 120), start))
        || /^\s*(?:bonus|per\s+(?:dollar|night|stay|flight|purchase))\b/i.test(after);
    }
  }
  return candidates.size === 1 && hasBalanceContext && !hasOfferContext ? [...candidates][0]! : null;
}

export interface ExtractedBalance {
  readonly providerId: string;
  readonly points: number;
  /** Page the value was read from (origin + path, no query/hash). */
  readonly sourceUrl?: string;
}

/** The shared Amex host cannot identify the US program by hostname alone. */
function hasUsRegion(url: URL, text: string): boolean {
  const segments = url.pathname.toLowerCase().split("/");
  if (segments.some(segment => /^(?:ca|uk|gb|sg|au|en-(?:ca|uk|gb|sg|au))$/.test(segment))) return false;
  if (segments.some(segment => /^[a-z]{2}-[a-z]{2}$/.test(segment) && !segment.endsWith("-us"))) return false;
  const leading = segments.filter(Boolean);
  if (/^[a-z]{2}$/.test(leading[0] ?? "") && !["us", "en"].includes(leading[0]!)) return false;
  if (leading[0] === "en" && /^[a-z]{2}$/.test(leading[1] ?? "") && leading[1] !== "us") return false;
  const declarations = [...text.matchAll(/\b(?:country(?:\s*\/\s*region)?|region|locale)\s*[:=]\s*([^\n\r]{1,80})/gi)];
  const isUs = (value: string) => /^(?:us|usa|united states|united states of america|en-us)$/i.test(value.trim());
  if (declarations.some(match => !isUs(match[1]!))) return false;
  return segments.some(segment => segment === "us" || segment === "en-us")
    || declarations.some(match => isUs(match[1]!));
}

/**
 * End-to-end: from a page URL + visible text to a {providerId, points}
 * capture, or null when the page isn't a known provider or no balance is found.
 */
export function extractBalance(input: {
  readonly url: string;
  readonly text: string;
}): ExtractedBalance | null {
  let hostname: string;
  let sourceUrl: string;
  let parsed: URL;
  try {
    parsed = new URL(input.url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    hostname = parsed.hostname;
    sourceUrl = parsed.origin + parsed.pathname;
  } catch {
    return null;
  }
  const rule = detectProvider(hostname);
  if (!rule) return null;
  if (rule.region === "US" && !hasUsRegion(parsed, input.text)) return null;
  const points = extractPointsWithRule(rule, input.text);
  return points === null ? null : { providerId: rule.providerId, points, sourceUrl };
}
