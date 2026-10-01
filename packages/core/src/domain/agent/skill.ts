import { PROVIDER_CATALOG } from "../loyalty/provider";
import { SkillNotFoundError } from "../errors";

/**
 * Agent skills: declarative, versioned playbooks that tell a browser/computer
 * agent how to read one fact (today: the points balance) from a provider's
 * site *inside the user's own, already-signed-in browser*. PointUp never sees
 * credentials; the agent reports only the observed value.
 *
 * A skill is data, not code, so adding a program is a catalog edit (open/
 * closed) and the allow-list below is enforced server-side on write-back.
 */

export type SkillMode = "browser" | "computer";

export interface AgentSkill {
  readonly id: string;
  readonly providerId: string;
  readonly title: string;
  readonly mode: SkillMode;
  /** Bumped whenever the playbook (URL, hosts, steps) changes. */
  readonly version: number;
  /**
   * ISO date a human last confirmed the start URL and hint against the live
   * site. `null` = never verified: URLs are best-effort and agents must say so.
   */
  readonly verifiedAt: string | null;
  /** True exactly when `verifiedAt` is null. Surfaced so agents stay honest. */
  readonly unverified: boolean;
  /** Provider-specific caveats an agent should know before reading the page. */
  readonly notes: readonly string[];
  /** Hosts (exact or `.suffix` match) the agent may read from for this skill. */
  readonly allowedHosts: readonly string[];
  /** Page to open first; the user must already be signed in. */
  readonly startUrl: string;
  /** Natural-language steps an agent follows. */
  readonly steps: readonly string[];
  /** What to extract and how to sanity-check it. */
  readonly extraction: {
    readonly field: "points";
    readonly hint: string;
  };
}

interface SkillSeed {
  readonly providerId: string;
  readonly startUrl: string;
  readonly allowedHosts: readonly string[];
  readonly hint: string;
  /** Bump when this seed changes; defaults to 1. */
  readonly version?: number;
  /** ISO date of the last human verification; omit while unverified. */
  readonly verifiedAt?: string;
  readonly notes?: readonly string[];
}

const SEEDS: readonly SkillSeed[] = [
  {
    providerId: "united",
    startUrl: "https://www.united.com/en/us/myunited",
    allowedHosts: ["united.com"],
    hint: "MileagePlus miles shown in the account header or summary card",
  },
  {
    providerId: "delta",
    startUrl: "https://www.delta.com/myprofile/overview",
    allowedHosts: ["delta.com"],
    hint: "SkyMiles balance on the profile overview",
  },
  {
    providerId: "american",
    startUrl: "https://www.aa.com/aadvantage-program/profile/account-summary",
    allowedHosts: ["aa.com"],
    hint: "AAdvantage miles on the account summary",
  },
  {
    providerId: "marriott",
    startUrl: "https://www.marriott.com/loyalty/myAccount/default.mi",
    allowedHosts: ["marriott.com"],
    hint: "Bonvoy points balance on My Account",
  },
  {
    providerId: "hilton",
    startUrl: "https://www.hilton.com/en/hilton-honors/guest/my-account/",
    allowedHosts: ["hilton.com"],
    hint: "Hilton Honors points on My Account",
  },
  {
    providerId: "hyatt",
    startUrl: "https://www.hyatt.com/profile/en-US/account-overview",
    allowedHosts: ["hyatt.com"],
    hint: "World of Hyatt points on the account overview",
  },
  {
    providerId: "chase-ultimate-rewards",
    startUrl: "https://ultimaterewardspoints.chase.com/",
    allowedHosts: ["chase.com"],
    hint: "Ultimate Rewards points total (not a single card's cash back)",
  },
  {
    providerId: "amex-membership-rewards",
    startUrl: "https://global.americanexpress.com/rewards",
    allowedHosts: ["americanexpress.com"],
    hint: "Membership Rewards points total",
  },
  {
    providerId: "capital-one-miles",
    startUrl: "https://myrewards.capitalone.com/",
    allowedHosts: ["capitalone.com"],
    hint: "Capital One miles balance",
  },
  {
    providerId: "citi-thankyou",
    startUrl: "https://www.thankyou.com/",
    allowedHosts: ["thankyou.com", "citi.com"],
    hint: "ThankYou points balance",
  },
  {
    providerId: "bilt",
    startUrl: "https://www.bilt.com/rewards",
    allowedHosts: ["bilt.com", "biltrewards.com"],
    hint: "Bilt Rewards points balance",
  },
  {
    providerId: "amtrak",
    startUrl: "https://www.amtrak.com/guestrewards/account-overview",
    allowedHosts: ["amtrak.com"],
    hint: "Amtrak Guest Rewards points on the account overview",
  },
  {
    providerId: "rakuten",
    startUrl: "https://www.rakuten.com/account/summary",
    allowedHosts: ["rakuten.com"],
    hint: "Rakuten Cash Back balance (dollars; report as whole cents)",
    notes: ["Balance is in dollars: submit whole cents (e.g. $12.34 -> 1234)."],
  },
];

const COMMON_STEPS = [
  "Confirm the user has granted PointUp consent for this program (the tool will refuse otherwise).",
  "Open the start URL in the user's own browser session. Do NOT ask for, type, or store a password; if signed out, stop and ask the user to sign in themselves.",
  "Wait for the balance to render; do not click through offers, redemptions, or any purchase flow.",
  "Read the single points/miles balance as an integer (strip commas and unit labels).",
  "Submit it with the observation tool, including the exact page URL you read it from.",
  "Report the outcome to the user; if it says needs_review, show them the value and ask before confirming.",
] as const;

const UNVERIFIED_NOTE = [
  "Start URL is best-effort and has not been verified against the live site; if it 404s or redirects, navigate from the provider's home page (same allowed hosts) and tell the user.",
] as const;

function buildSkills(): AgentSkill[] {
  const known = new Set(PROVIDER_CATALOG.map((provider) => provider.id));
  return SEEDS.filter((seed) => known.has(seed.providerId)).flatMap((seed) => {
    const provider = PROVIDER_CATALOG.find((p) => p.id === seed.providerId)!;
    const base = {
      providerId: seed.providerId,
      version: seed.version ?? 1,
      verifiedAt: seed.verifiedAt ?? null,
      unverified: seed.verifiedAt === undefined,
      notes: [...UNVERIFIED_NOTE.filter(() => seed.verifiedAt === undefined), ...(seed.notes ?? [])],
      allowedHosts: seed.allowedHosts,
      startUrl: seed.startUrl,
      steps: COMMON_STEPS,
      extraction: { field: "points" as const, hint: seed.hint },
    };
    return [
      {
        ...base,
        id: `${seed.providerId}.capture-balance`,
        title: `Read your ${provider.displayName} balance (browser)`,
        mode: "browser" as const,
      },
      {
        ...base,
        id: `${seed.providerId}.capture-balance.computer`,
        title: `Read your ${provider.displayName} balance (computer use)`,
        mode: "computer" as const,
      },
    ];
  });
}

export const AGENT_SKILL_CATALOG: readonly AgentSkill[] = buildSkills();

export function findSkill(skillId: string): AgentSkill | undefined {
  return AGENT_SKILL_CATALOG.find((skill) => skill.id === skillId);
}

export function getSkillOrThrow(skillId: string): AgentSkill {
  const skill = findSkill(skillId);
  if (!skill) throw new SkillNotFoundError(skillId);
  return skill;
}

/** True when `host` equals an allowed host or is a subdomain of it. */
export function isHostAllowed(skill: AgentSkill, host: string): boolean {
  const normalized = host.toLowerCase();
  return skill.allowedHosts.some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`),
  );
}
