import { describe, expect, it } from "vitest";
import { AGENT_SKILL_CATALOG, getSkillOrThrow, isHostAllowed } from "../src/domain/agent/skill";

describe("capture source host policy", () => {
  it("allows each catalog start host without implicitly trusting its subdomains", () => {
    for (const skill of AGENT_SKILL_CATALOG) {
      const host = new URL(skill.startUrl).hostname;
      expect(isHostAllowed(skill, host)).toBe(true);
      expect(isHostAllowed(skill, host.toUpperCase())).toBe(true);
      expect(isHostAllowed(skill, `unreviewed.${host}`)).toBe(false);
      expect(isHostAllowed(skill, `${host}.example`)).toBe(false);
      expect(isHostAllowed(skill, `${host}.`)).toBe(false);
    }
  });

  it("keeps explicitly seeded bank rewards hosts while rejecting arbitrary issuer subdomains", () => {
    const chase = getSkillOrThrow("chase-ultimate-rewards.capture-balance");
    expect(isHostAllowed(chase, "ultimaterewardspoints.chase.com")).toBe(true);
    expect(isHostAllowed(chase, "chase.com")).toBe(true);
    expect(isHostAllowed(chase, "www.chase.com")).toBe(true);
    expect(isHostAllowed(chase, "unreviewed.chase.com")).toBe(false);
  });
});
