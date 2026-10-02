import { describe, expect, it } from "vitest";

import {
  AuthenticateAccessToken,
  IssueAccessToken,
  RevokeAccessToken,
} from "../src/application/agent/access-tokens";
import { GrantConsent, RevokeConsent } from "../src/application/agent/consents";
import { ListAgentSkills } from "../src/application/agent/list-skills";
import {
  ResolveObservationReview,
  SubmitObservation,
} from "../src/application/agent/submit-observation";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { AGENT_SKILL_CATALOG } from "../src/domain/agent/skill";
import { PROVIDER_CATALOG } from "../src/domain/loyalty/provider";
import {
  AtomicObservationEventing,
  InMemoryActivityEventRepository,
  InMemoryBalanceSnapshotRepository,
  InMemoryConsents,
  InMemoryLoyaltyAccountRepository,
  InMemoryObservations,
  InMemoryTokens,
} from "./fakes";

import { asConsentId, asObservationId, asUserId } from "./ids";
let now = new Date("2026-07-08T12:00:00.000Z");
const clock = { now: () => now };

function setup() {
  now = new Date("2026-07-08T12:00:00.000Z");
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const activity = new InMemoryActivityEventRepository();
  const consents = new InMemoryConsents();
  const observations = new InMemoryObservations({ accounts, consents });
  const eventing = new AtomicObservationEventing({ accounts, balances, activity, observations, consents });
  const link = new LinkLoyaltyAccount(accounts, activity, clock, eventing);
  const record = new RecordManualBalance(accounts, balances, activity, clock, eventing);
  const submit = new SubmitObservation(
    accounts,
    balances,
    consents,
    observations,
    record,
    link,
    clock,
    eventing,
  );
  const grant = new GrantConsent(consents, clock);
  const review = new ResolveObservationReview(accounts, balances, observations, record, clock, eventing);
  return { review, accounts, balances, activity, consents, observations, submit, grant, link, record };
}

const base = {
  userId: asUserId("u1"),
  skillId: "united.capture-balance",
  sourceUrl: "https://www.united.com/en/us/myunited?token=secret",
  agent: "test-agent",
  canLinkAccount: true,
};

describe("access tokens", () => {
  it("issues a hashed token, authenticates it, and revokes it", async () => {
    const tokens = new InMemoryTokens();
    const issued = await new IssueAccessToken(tokens, clock).execute({
      userId: asUserId("u1"),
      name: "claude",
      scopes: ["portfolio:read"],
      ttlDays: 7,
    });
    expect(issued.plaintext.startsWith("pu_")).toBe(true);
    const stored = [...tokens.rows.values()][0]!;
    expect(stored.tokenHash).not.toContain(issued.plaintext);

    const auth = new AuthenticateAccessToken(tokens, clock);
    expect(await auth.execute(issued.plaintext)).toMatchObject({
      userId: "u1",
      scopes: ["portfolio:read"],
    });

    await new RevokeAccessToken(tokens, clock).execute(asUserId("u1"), issued.token.id);
    await expect(auth.execute(issued.plaintext)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("rejects expired and unknown tokens, and other users' revokes", async () => {
    const tokens = new InMemoryTokens();
    const issued = await new IssueAccessToken(tokens, clock).execute({
      userId: asUserId("u1"),
      name: "short",
      scopes: ["portfolio:read"],
      ttlDays: 1,
    });
    const auth = new AuthenticateAccessToken(tokens, clock);
    await expect(auth.execute("pu_nope")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      new RevokeAccessToken(tokens, clock).execute(asUserId("u2"), issued.token.id),
    ).rejects.toMatchObject({ code: "ACCESS_TOKEN_NOT_FOUND" });
    now = new Date(now.getTime() + 2 * 86_400_000);
    await expect(auth.execute(issued.plaintext)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("validates name, scopes, and ttl", async () => {
    const issue = new IssueAccessToken(new InMemoryTokens(), clock);
    await expect(
      issue.execute({ userId: asUserId("u"), name: " ", scopes: ["portfolio:read"] }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN_REQUEST" });
    await expect(
      issue.execute({ userId: asUserId("u"), name: "x", scopes: [] }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN_REQUEST" });
    await expect(
      issue.execute({ userId: asUserId("u"), name: "x", scopes: ["portfolio:read"], ttlDays: 9999 }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN_REQUEST" });
  });
});

describe("GrantConsent", () => {
  it("keeps one open grant per provider and rejects unknown providers", async () => {
    const s = setup();
    const first = await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    const second = await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    const open = [...s.consents.rows.values()].filter((c) => !c.revokedAt);
    expect(open.map((c) => c.id)).toEqual([second.id]);
    expect(s.consents.rows.get(first.id)?.revokedAt).not.toBeNull();
    await expect(
      s.grant.execute({ userId: asUserId("u1"), providerId: "nope" }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_SUPPORTED" });
  });

  it("revoking any grant for a provider revokes every open one", async () => {
    const s = setup();
    const a = await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    // A stray duplicate (e.g. legacy data from before the unique index).
    s.consents.rows.set(asConsentId("dup"), { ...s.consents.rows.get(a.id)!, id: asConsentId("dup") });
    await new RevokeConsent(s.consents, clock).execute(asUserId("u1"), asConsentId("dup"));
    expect([...s.consents.rows.values()].every((c) => c.revokedAt)).toBe(true);
  });
});

describe("skill catalog", () => {
  it("has a browser and computer skill for every seeded provider, on https hosts", () => {
    // Skills are optional per provider: a program without a confidently known
    // login host gets none rather than a guessed URL.
    expect(AGENT_SKILL_CATALOG.length).toBeGreaterThan(0);
    for (const provider of PROVIDER_CATALOG.filter((p) => p.agentSkill)) {
      const skills = AGENT_SKILL_CATALOG.filter((s) => s.providerId === provider.id);
      expect(skills.map((s) => s.mode).sort()).toEqual(["browser", "computer"]);
      for (const skill of skills) {
        expect(skill.startUrl.startsWith("https://")).toBe(true);
        expect(new URL(skill.startUrl).hostname).toMatch(
          new RegExp(`(^|\\.)(${skill.allowedHosts.map((h) => h.replaceAll(".", "\\.")).join("|")})$`),
        );
      }
    }
  });

  it("is honest about verification: unverified iff verifiedAt is null, with a caveat note", () => {
    for (const skill of AGENT_SKILL_CATALOG) {
      expect(skill.version).toBeGreaterThanOrEqual(1);
      expect(skill.unverified).toBe(skill.verifiedAt === null);
      if (skill.unverified) {
        expect(skill.notes.join(" ")).toMatch(/best-effort/);
      } else {
        expect(Number.isNaN(Date.parse(skill.verifiedAt!))).toBe(false);
      }
    }
    expect(AGENT_SKILL_CATALOG.find((k) => k.id === "rakuten.capture-balance")!.notes.join(" ")).toMatch(/cents/);
  });

  it("annotates skills with link and consent state", async () => {
    const s = setup();
    await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    const skills = await new ListAgentSkills(s.accounts, s.consents, clock).execute(
      asUserId("u1"),
      { providerId: "united" },
    );
    expect(skills.every((k) => k.accountLinked && k.consentActive)).toBe(true);
  });
});

describe("SubmitObservation", () => {
  it("refuses without consent", async () => {
    const s = setup();
    await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
    await expect(s.submit.execute({ ...base, points: 100 })).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
  });

  it("refuses revoked and expired consent", async () => {
    const s = setup();
    await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
    const consent = await s.grant.execute({ userId: asUserId("u1"), providerId: "united", days: 1 });
    await new RevokeConsent(s.consents, clock).execute(asUserId("u1"), consent.id);
    await expect(s.submit.execute({ ...base, points: 1 })).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    await s.grant.execute({ userId: asUserId("u1"), providerId: "united", days: 1 });
    now = new Date(now.getTime() + 2 * 86_400_000);
    await expect(s.submit.execute({ ...base, points: 1 })).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
  });

  it("records an agent balance with provenance and stores only the host", async () => {
    const s = setup();
    await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    const result = await s.submit.execute({ ...base, points: 48_320 });
    expect(result).toMatchObject({ outcome: "recorded", previousPoints: null });
    expect(s.balances.rows.at(-1)?.source).toBe("agent");
    expect(s.activity.rows.at(-1)?.type).toBe("balance_agent");
    expect(s.observations.rows[0]?.sourceHost).toBe("www.united.com");
    expect(JSON.stringify(s.observations.rows)).not.toContain("secret");
  });

  it("is idempotent for an unchanged balance", async () => {
    const s = setup();
    await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    await s.submit.execute({ ...base, points: 500 });
    const again = await s.submit.execute({ ...base, points: 500 });
    expect(again.outcome).toBe("unchanged");
    expect(s.balances.rows).toHaveLength(1);
  });

  it("holds implausible jumps and ignores any agent-supplied confirmation", async () => {
    const s = setup();
    await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    await s.submit.execute({ ...base, points: 50_000 });
    const held = await s.submit.execute({ ...base, points: 5 });
    expect(held.outcome).toBe("needs_review");
    expect(held.reviewId).toEqual(expect.any(String));
    expect(s.balances.rows).toHaveLength(1);
    // Resubmitting (even with a smuggled flag) is held again, never written.
    const again = await s.submit.execute({ ...base, points: 5, confirmed: true } as typeof base & { points: number });
    expect(again.outcome).toBe("needs_review");
    expect(again.reviewId).not.toBe(held.reviewId);
    expect(s.balances.rows).toHaveLength(1);
  });

  it("holds an implausible FIRST reading above the sanity cap", async () => {
    const s = setup();
    await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    const held = await s.submit.execute({ ...base, points: 9_000_000 });
    expect(held).toMatchObject({ outcome: "needs_review", previousPoints: null });
    expect(s.balances.rows).toHaveLength(0);
    const ok = await s.submit.execute({ ...base, points: 40_000 });
    expect(ok.outcome).toBe("recorded");
  });

  describe("human review", () => {
    async function held() {
      const s = setup();
      await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
      await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
      await s.submit.execute({ ...base, points: 50_000 });
      const result = await s.submit.execute({ ...base, points: 5 });
      return { s, reviewId: result.reviewId! };
    }

    it("confirm writes the balance with source agent, once", async () => {
      const { s, reviewId } = await held();
      const result = await s.review.confirm(asUserId("u1"), reviewId);
      expect(result).toMatchObject({ outcome: "recorded", points: 5, previousPoints: 50_000 });
      expect(s.balances.rows.at(-1)).toMatchObject({ points: 5, source: "agent" });
      expect(s.observations.rows.find((o) => o.id === reviewId)?.outcome).toBe("recorded");
      await expect(s.review.confirm(asUserId("u1"), reviewId)).rejects.toMatchObject({
        code: "REVIEW_ALREADY_RESOLVED",
      });
      await expect(s.review.reject(asUserId("u1"), reviewId)).rejects.toMatchObject({
        code: "REVIEW_ALREADY_RESOLVED",
      });
      expect(s.balances.rows).toHaveLength(2);
    });

    it("reject discards and cannot be confirmed afterwards", async () => {
      const { s, reviewId } = await held();
      expect((await s.review.reject(asUserId("u1"), reviewId)).outcome).toBe("rejected");
      await expect(s.review.confirm(asUserId("u1"), reviewId)).rejects.toMatchObject({
        code: "REVIEW_ALREADY_RESOLVED",
      });
      expect(s.balances.rows).toHaveLength(1);
    });

    it("is scoped to the owner and to review rows", async () => {
      const { s, reviewId } = await held();
      await expect(s.review.confirm(asUserId("u2"), reviewId)).rejects.toMatchObject({
        code: "REVIEW_NOT_FOUND",
      });
      await expect(s.review.confirm(asUserId("u1"), asObservationId("nope"))).rejects.toMatchObject({
        code: "REVIEW_NOT_FOUND",
      });
      const recorded = s.observations.rows.find((o) => o.outcome === "recorded")!;
      await expect(s.review.confirm(asUserId("u1"), recorded.id)).rejects.toMatchObject({
        code: "REVIEW_ALREADY_RESOLVED",
      });
    });

    it("expires after 24 hours", async () => {
      const { s, reviewId } = await held();
      now = new Date(now.getTime() + 25 * 3_600_000);
      await expect(s.review.confirm(asUserId("u1"), reviewId)).rejects.toMatchObject({
        code: "REVIEW_EXPIRED",
      });
      expect(s.balances.rows).toHaveLength(1);
    });

    it("refuses when the latest balance changed since the hold", async () => {
      const { s, reviewId } = await held();
      const account = [...s.accounts.rows.values()][0]!;
      now = new Date(now.getTime() + 60_000);
      await s.record.execute({ userId: asUserId("u1"), accountId: account.id, points: 51_000, source: "manual" });
      await expect(s.review.confirm(asUserId("u1"), reviewId)).rejects.toMatchObject({
        code: "REVIEW_STALE",
      });
    });
  });

  it("rejects off-allowlist hosts, non-https, and bad skills", async () => {
    const s = setup();
    await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    for (const sourceUrl of [
      "https://evil.example/united.com",
      "https://united.com.evil.example/",
      "http://www.united.com/",
      "not a url",
    ]) {
      await expect(
        s.submit.execute({ ...base, sourceUrl, points: 1 }),
      ).rejects.toMatchObject({ code: "INVALID_OBSERVATION" });
    }
    await expect(
      s.submit.execute({ ...base, skillId: "nope", points: 1 }),
    ).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
  });

  it("auto-links only with a membership number AND permission to link", async () => {
    const s = setup();
    await s.grant.execute({ userId: asUserId("u1"), providerId: "united" });
    await expect(s.submit.execute({ ...base, points: 10 })).rejects.toMatchObject({
      code: "LOYALTY_ACCOUNT_NOT_FOUND",
    });
    // observations:write alone (no portfolio:write) must not create accounts.
    await expect(
      s.submit.execute({ ...base, canLinkAccount: false, points: 10, membershipNumber: "MP9" }),
    ).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    expect(s.accounts.rows.size).toBe(0);
    const result = await s.submit.execute({
      ...base,
      points: 10,
      membershipNumber: "MP9",
    });
    expect(result.outcome).toBe("recorded");
    expect(s.accounts.rows.size).toBe(1);
  });

  it("never writes to another user's account", async () => {
    const s = setup();
    await s.link.execute({ userId: asUserId("u1"), providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: asUserId("u2"), providerId: "united" });
    // u2 has consent but no account of their own and supplies no member number.
    await expect(
      s.submit.execute({ ...base, userId: asUserId("u2"), points: 99 }),
    ).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    expect(s.balances.rows).toHaveLength(0);
  });
});
