import { describe, expect, it } from "vitest";
import { PROVIDER_KINDS } from "@pointup/core/providers";
import { filterAccounts } from "./account-filter";
const accounts = PROVIDER_KINDS.map((kind, index) => ({ provider: { id: `provider-${index}`, kind, displayName: `Program ${kind}`, pointsCurrency: "points", estimatedCentsPerPoint: 1, inactivityExpiryMonths: null }, membershipNumber: `Member-${index}`, tags: index % 2 ? ["Family"] : ["Travel"] }));
describe("portfolio program filtering", () => {
  it("supports all catalog kinds without native-only omissions", () => {
    expect(PROVIDER_KINDS).toHaveLength(9);
    for (const kind of PROVIDER_KINDS) expect(filterAccounts(accounts, { query: "", kind, tag: null }).map(account => account.provider.kind)).toEqual([kind]);
  });
  it("intersects trimmed case-insensitive search, type and exact selected tag", () => {
    const account = accounts[1]!;
    expect(filterAccounts(accounts, { query: "  mEMBER-1  ", kind: account.provider.kind, tag: "Family" })).toEqual([account]);
    expect(filterAccounts(accounts, { query: "Member-1", kind: account.provider.kind, tag: "Travel" })).toEqual([]);
    expect(filterAccounts(accounts, { query: "Family", kind: "all", tag: null })).toEqual(accounts.filter(value => value.tags.includes("Family")));
  });
  it("searches program names and preserves server order through filtering/reset", () => {
    const reordered = [...accounts].reverse();
    expect(filterAccounts(reordered, { query: "PROGRAM", kind: "all", tag: "Travel" })).toEqual(reordered.filter(account => account.tags.includes("Travel")));
    expect(filterAccounts(reordered, { query: "", kind: "all", tag: null })).toEqual(reordered);
    expect(filterAccounts([], { query: "missing", kind: "all", tag: null })).toEqual([]);
  });
});
