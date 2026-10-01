import { describe, expect, it } from "vitest";

import {
  AuthenticateAccessToken,
  IssueAccessToken,
  RevokeAccessToken,
} from "../src/application/agent/access-tokens";
import { GrantConsent, RevokeConsent } from "../src/application/agent/consents";
import { ListAgentSkills } from "../src/application/agent/list-skills";
import { SubmitObservation } from "../src/application/agent/submit-observation";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import type {
  AccessToken,
  AccessTokenRepository,
} from "../src/domain/agent/access-token";
import type {
  ConsentGrant,
  ConsentGrantRepository,
} from "../src/domain/agent/consent";
import type {
  AgentObservation,
  AgentObservationRepository,
} from "../src/domain/agent/observation";
import { AGENT_SKILL_CATALOG } from "../src/domain/agent/skill";
import { PROVIDER_CATALOG } from "../src/domain/loyalty/provider";
import {
  InMemoryActivityEventRepository,
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";

class InMemoryTokens implements AccessTokenRepository {
  readonly rows = new Map<string, AccessToken>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByHash(hash: string) {
    return [...this.rows.values()].find((t) => t.tokenHash === hash) ?? null;
  }
  async findByUserId(userId: string) {
    return [...this.rows.values()].filter((t) => t.userId === userId);
  }
  async insert(token: AccessToken) {
    this.rows.set(token.id, token);
  }
  async update(token: AccessToken) {
    this.rows.set(token.id, token);
  }
}

class InMemoryConsents implements ConsentGrantRepository {
  readonly rows = new Map<string, ConsentGrant>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByUserId(userId: string) {
    return [...this.rows.values()].filter((c) => c.userId === userId);
  }
  async insert(c: ConsentGrant) {
    this.rows.set(c.id, c);
  }
  async update(c: ConsentGrant) {
    this.rows.set(c.id, c);
  }
}

class InMemoryObservations implements AgentObservationRepository {
  readonly rows: AgentObservation[] = [];
  async insert(o: AgentObservation) {
    this.rows.push(o);
  }
  async findByUserId(userId: string) {
    return this.rows.filter((o) => o.userId === userId);
  }
}

let now = new Date("2026-07-08T12:00:00.000Z");
const clock = { now: () => now };

function setup() {
  now = new Date("2026-07-08T12:00:00.000Z");
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const activity = new InMemoryActivityEventRepository();
  const consents = new InMemoryConsents();
  const observations = new InMemoryObservations();
  const link = new LinkLoyaltyAccount(accounts, activity, clock);
  const record = new RecordManualBalance(accounts, balances, activity, clock);
  const submit = new SubmitObservation(
    accounts,
    balances,
    consents,
    observations,
    record,
    link,
    clock,
  );
  const grant = new GrantConsent(consents, clock);
  return { accounts, balances, activity, consents, observations, submit, grant, link, record };
}

const base = {
  userId: "u1",
  skillId: "united.capture-balance",
  sourceUrl: "https://www.united.com/en/us/myunited?token=secret",
  agent: "test-agent",
};

describe("access tokens", () => {
  it("issues a hashed token, authenticates it, and revokes it", async () => {
    const tokens = new InMemoryTokens();
    const issued = await new IssueAccessToken(tokens, clock).execute({
      userId: "u1",
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

    await new RevokeAccessToken(tokens, clock).execute("u1", issued.token.id);
    await expect(auth.execute(issued.plaintext)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("rejects expired and unknown tokens, and other users' revokes", async () => {
    const tokens = new InMemoryTokens();
    const issued = await new IssueAccessToken(tokens, clock).execute({
      userId: "u1",
      name: "short",
      scopes: ["portfolio:read"],
      ttlDays: 1,
    });
    const auth = new AuthenticateAccessToken(tokens, clock);
    await expect(auth.execute("pu_nope")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      new RevokeAccessToken(tokens, clock).execute("u2", issued.token.id),
    ).rejects.toMatchObject({ code: "ACCESS_TOKEN_NOT_FOUND" });
    now = new Date(now.getTime() + 2 * 86_400_000);
    await expect(auth.execute(issued.plaintext)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("validates name, scopes, and ttl", async () => {
    const issue = new IssueAccessToken(new InMemoryTokens(), clock);
    await expect(
      issue.execute({ userId: "u", name: " ", scopes: ["portfolio:read"] }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN_REQUEST" });
    await expect(
      issue.execute({ userId: "u", name: "x", scopes: [] }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN_REQUEST" });
    await expect(
      issue.execute({ userId: "u", name: "x", scopes: ["portfolio:read"], ttlDays: 9999 }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN_REQUEST" });
  });
});

describe("skill catalog", () => {
  it("has a browser and computer skill per provider with https hosts", () => {
    for (const provider of PROVIDER_CATALOG) {
      const skills = AGENT_SKILL_CATALOG.filter((s) => s.providerId === provider.id);
      expect(skills.map((s) => s.mode).sort()).toEqual(["browser", "computer"]);
      for (const skill of skills) {
        expect(skill.startUrl.startsWith("https://")).toBe(true);
        expect(new URL(skill.startUrl).hostname).toMatch(
          new RegExp(`(^|\\.)(${skill.allowedHosts.map((h) => h.replace(".", "\\.")).join("|")})$`),
        );
      }
    }
  });

  it("annotates skills with link and consent state", async () => {
    const s = setup();
    await s.link.execute({ userId: "u1", providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: "u1", providerId: "united" });
    const skills = await new ListAgentSkills(s.accounts, s.consents, clock).execute(
      "u1",
      { providerId: "united" },
    );
    expect(skills.every((k) => k.accountLinked && k.consentActive)).toBe(true);
  });
});

describe("SubmitObservation", () => {
  it("refuses without consent", async () => {
    const s = setup();
    await s.link.execute({ userId: "u1", providerId: "united", membershipNumber: "M1" });
    await expect(s.submit.execute({ ...base, points: 100 })).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
  });

  it("refuses revoked and expired consent", async () => {
    const s = setup();
    await s.link.execute({ userId: "u1", providerId: "united", membershipNumber: "M1" });
    const consent = await s.grant.execute({ userId: "u1", providerId: "united", days: 1 });
    await new RevokeConsent(s.consents, clock).execute("u1", consent.id);
    await expect(s.submit.execute({ ...base, points: 1 })).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    await s.grant.execute({ userId: "u1", providerId: "united", days: 1 });
    now = new Date(now.getTime() + 2 * 86_400_000);
    await expect(s.submit.execute({ ...base, points: 1 })).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
  });

  it("records an agent balance with provenance and stores only the host", async () => {
    const s = setup();
    await s.link.execute({ userId: "u1", providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: "u1", providerId: "united" });
    const result = await s.submit.execute({ ...base, points: 48_320 });
    expect(result).toMatchObject({ outcome: "recorded", previousPoints: null });
    expect(s.balances.rows.at(-1)?.source).toBe("agent");
    expect(s.activity.rows.at(-1)?.type).toBe("balance_agent");
    expect(s.observations.rows[0]?.sourceHost).toBe("www.united.com");
    expect(JSON.stringify(s.observations.rows)).not.toContain("secret");
  });

  it("is idempotent for an unchanged balance", async () => {
    const s = setup();
    await s.link.execute({ userId: "u1", providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: "u1", providerId: "united" });
    await s.submit.execute({ ...base, points: 500 });
    const again = await s.submit.execute({ ...base, points: 500 });
    expect(again.outcome).toBe("unchanged");
    expect(s.balances.rows).toHaveLength(1);
  });

  it("holds implausible jumps until confirmed", async () => {
    const s = setup();
    await s.link.execute({ userId: "u1", providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: "u1", providerId: "united" });
    await s.submit.execute({ ...base, points: 50_000 });
    const held = await s.submit.execute({ ...base, points: 5 });
    expect(held.outcome).toBe("needs_review");
    expect(s.balances.rows).toHaveLength(1);
    const confirmed = await s.submit.execute({ ...base, points: 5, confirmed: true });
    expect(confirmed.outcome).toBe("recorded");
  });

  it("rejects off-allowlist hosts, non-https, and bad skills", async () => {
    const s = setup();
    await s.link.execute({ userId: "u1", providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: "u1", providerId: "united" });
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

  it("auto-links only when a membership number is supplied", async () => {
    const s = setup();
    await s.grant.execute({ userId: "u1", providerId: "united" });
    await expect(s.submit.execute({ ...base, points: 10 })).rejects.toMatchObject({
      code: "LOYALTY_ACCOUNT_NOT_FOUND",
    });
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
    await s.link.execute({ userId: "u1", providerId: "united", membershipNumber: "M1" });
    await s.grant.execute({ userId: "u2", providerId: "united" });
    // u2 has consent but no account of their own and supplies no member number.
    await expect(
      s.submit.execute({ ...base, userId: "u2", points: 99 }),
    ).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    expect(s.balances.rows).toHaveLength(0);
  });
});
