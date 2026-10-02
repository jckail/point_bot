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
  /** Hostname substrings that identify this provider's site. */
  readonly hosts: readonly string[];
  /** Numeric unit patterns; conflicting readings are refused. */
  readonly patterns: readonly RegExp[];
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
    providerId: "southwest",
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
];

/** Hosts the content script should run on (for the manifest matches). */
export function providerHostGlobs(): string[] {
  return PROVIDER_PAGE_RULES.flatMap((rule) =>
    rule.hosts.map((host) => `https://*.${host}/*`),
  );
}

export function detectProvider(hostname: string): ProviderPageRule | null {
  const host = hostname.toLowerCase();
  return (
    PROVIDER_PAGE_RULES.find((rule) =>
      rule.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
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
      const index = match.index ?? 0;
      const before = text.slice(Math.max(0, index - 120), index);
      const after = text.slice(index + match[0].length, index + match[0].length + 60);
      // A suffix of a decimal, negative, exponent or space-grouped value is
      // not a whole balance, even when the suffix itself is a safe integer.
      if (/[\p{L}\p{N}.,_+\-−]$/u.test(before) || /(?:\d|[+\-−])\s+$/.test(before)) continue;
      const points = match[1] ? parsePoints(match[1]) : null;
      if (points === null) continue;
      candidates.add(points);
      hasBalanceContext ||= text.trim() === match[0].trim()
        || /\b(?:balance|(?:available|current|total)(?:\s+(?:points|miles))?|you\s+have|your\s+(?:bonvoy\s+)?points)\s*[:–-]?\s*$/i.test(before)
        || /^\s*(?:available|remaining|balance)\b/i.test(after);
      hasOfferContext ||= /\b(?:earn|redeem|bonus|welcome\s+offer|up\s+to|starting\s+at|from|spend|win)\b[^\n.!?]{0,32}$/i.test(before)
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
  try {
    const parsed = new URL(input.url);
    hostname = parsed.hostname;
    sourceUrl = parsed.origin + parsed.pathname;
  } catch {
    return null;
  }
  const rule = detectProvider(hostname);
  if (!rule) return null;
  const points = extractPointsWithRule(rule, input.text);
  return points === null ? null : { providerId: rule.providerId, points, sourceUrl };
}
