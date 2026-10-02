"use client";

import type { LoyaltyAccountReadModel, ProviderSyncMode } from "@pointup/core";
import { PROVIDER_KINDS, PROVIDER_KIND_LABELS } from "@pointup/core/providers";
import { useMemo, useState } from "react";
import { AccountCard } from "@/components/account-card";
import { filterAccounts, type AccountFilters } from "@/components/account-filter";

export function AccountGrid({ accounts, syncModes }: { accounts: LoyaltyAccountReadModel[]; syncModes: Record<string, ProviderSyncMode> }) {
  const [filters, setFilters] = useState<AccountFilters>({ query: "", kind: "all", tag: null });
  const allTags = useMemo(() => [...new Set(accounts.flatMap(account => account.tags))].sort(), [accounts]);
  const visible = filterAccounts(accounts, filters);
  const filtered = filters.query !== "" || filters.kind !== "all" || filters.tag !== null;
  function reset() { setFilters({ query: "", kind: "all", tag: null }); }
  return <div className="flex min-w-0 flex-col gap-5">
    <div className="account-tools">
      <label className="account-search text-sm font-medium text-ink-muted">Find a program
        <input type="search" value={filters.query} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))} placeholder="Program, membership number or tag" className="rounded-xl border border-line bg-surface px-3 py-2.5 text-ink placeholder:text-ink-faint" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-ink-muted">Program type
        <select value={filters.kind} onChange={event => { const kind = PROVIDER_KINDS.find(value => value === event.target.value) ?? "all"; setFilters(current => ({ ...current, kind })); }} className="rounded-xl border border-line bg-surface px-3 py-2.5 text-ink">
          <option value="all">All types</option>
          {PROVIDER_KINDS.filter(kind => accounts.some(account => account.provider.kind === kind)).map(kind => <option key={kind} value={kind}>{PROVIDER_KIND_LABELS[kind]}</option>)}
        </select>
      </label>
      {filtered && <button type="button" onClick={reset} className="self-end rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-brand">Reset filters</button>}
    </div>
    {allTags.length > 0 && <div role="group" aria-label="Filter programs by tag" className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">Tags</span>
      {[null, ...allTags].map(tag => <button key={tag === null ? "all" : `tag:${tag}`} type="button" aria-pressed={filters.tag === tag} onClick={() => setFilters(current => ({ ...current, tag }))} className={`max-w-full break-words rounded-full border px-3 py-2 text-xs font-semibold ${filters.tag === tag ? "border-brand bg-brand/10 text-brand" : "border-line bg-surface text-ink-muted"}`}>{tag ?? "All tags"}</button>)}
    </div>}
    <p role="status" aria-live="polite" className="text-sm text-ink-muted">{visible.length} of {accounts.length} programs</p>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map(account => <AccountCard key={account.id} account={account} syncMode={syncModes[account.provider.id] ?? "unavailable"} />)}</div>
    {visible.length === 0 && <div className="card-surface p-6"><p className="font-semibold text-ink">No programs match your filters.</p><p className="mt-1 text-sm text-ink-muted">Try a different name, type or tag.</p><button type="button" onClick={reset} className="mt-3 rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-brand">Show all programs</button></div>}
  </div>;
}
