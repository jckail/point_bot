/**
 * Pure, framework-free balance extraction. Given a page's hostname and visible
 * text, detect which loyalty provider the page belongs to and pull the balance
 * out of it — no DOM, no chrome APIs — so it can be unit-tested exhaustively.
 *
 * These are best-effort heuristics keyed on each program's balance wording;
 * they're intentionally conservative (a keyword must be present) to avoid
 * grabbing an unrelated number. Tune the patterns per provider over time.
 */

export interface ProviderPageRule {
  readonly providerId: string;
  /** Hostname substrings that identify this provider's site. */
  readonly hosts: readonly string[];
  /** Ordered regexes; first one whose capture group holds a number wins. */
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
  const digits = raw.replace(/,/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

export function extractPointsWithRule(
  rule: ProviderPageRule,
  text: string,
): number | null {
  for (const pattern of rule.patterns) {
    const match = pattern.exec(text);
    const points = match?.[1] ? parsePoints(match[1]) : null;
    if (points !== null) return points;
  }
  return null;
}

export interface ExtractedBalance {
  readonly providerId: string;
  readonly points: number;
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
  try {
    hostname = new URL(input.url).hostname;
  } catch {
    return null;
  }
  const rule = detectProvider(hostname);
  if (!rule) return null;
  const points = extractPointsWithRule(rule, input.text);
  return points === null ? null : { providerId: rule.providerId, points };
}
