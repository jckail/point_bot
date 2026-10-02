import type { LoyaltyAccountReadModel } from "@pointup/core";
import type { ProviderKind } from "@pointup/core/providers";

export type AccountFilters = { query: string; kind: ProviderKind | "all"; tag: string | null };
type SearchableAccount = Pick<LoyaltyAccountReadModel, "membershipNumber" | "tags"> & {
  provider: Pick<LoyaltyAccountReadModel["provider"], "displayName" | "kind">;
};
/** Search and selectors intersect; filtering preserves pinned/server order. */
export function filterAccounts<T extends SearchableAccount>(accounts: readonly T[], filters: AccountFilters): T[] {
  const query = filters.query.trim().toLocaleLowerCase("en-US");
  return accounts.filter(account =>
    (filters.kind === "all" || account.provider.kind === filters.kind) &&
    (filters.tag === null || account.tags.includes(filters.tag)) &&
    `${account.provider.displayName} ${account.membershipNumber} ${account.tags.join(" ")}`.toLocaleLowerCase("en-US").includes(query),
  );
}
