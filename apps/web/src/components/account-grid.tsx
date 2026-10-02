"use client";
import type { LoyaltyAccountReadModel } from "@pointup/core";
import { useMemo, useState } from "react";
import { AccountCard } from "@/components/account-card";

export function AccountGrid({ accounts }: { accounts: LoyaltyAccountReadModel[] }) {
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const allTags = useMemo(() => [...new Set(accounts.flatMap(account => account.tags))].sort(), [accounts]);
  const kinds = [...new Set(accounts.map(account => account.provider.kind))];
  const visible = accounts.filter(account =>
    (!tagFilter || account.tags.includes(tagFilter)) &&
    (kind === "all" || account.provider.kind === kind) &&
    `${account.provider.displayName} ${account.membershipNumber} ${account.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  return <div className="flex flex-col gap-5">
    <div className="account-tools">
      <label className="account-search font-medium text-ink-muted">Find a program<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Program, membership, or tag" className="rounded-xl border border-line bg-surface px-3 py-2.5 text-ink placeholder:text-ink-faint"/></label>
      <label className="flex flex-col gap-1 text-sm font-medium text-ink-muted">Program type<select value={kind} onChange={event=>setKind(event.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2.5 text-ink"><option value="all">All types</option>{kinds.map(value=><option key={value} value={value}>{value === "credit_card" ? "Credit card" : value.charAt(0).toUpperCase()+value.slice(1)}</option>)}</select></label>
    </div>
    {allTags.length > 0 && <div className="flex flex-wrap items-center gap-2" aria-label="Filter programs by tag"><span className="mr-1 text-sm text-ink-muted">Tags</span>{[null,...allTags].map(tag=><button key={tag ?? "all"} type="button" aria-pressed={tagFilter === tag} onClick={()=>setTagFilter(tag)} className={`rounded-full border px-3 py-2 text-xs font-semibold ${tagFilter===tag ? "border-brand bg-brand/10 text-brand" : "border-line bg-surface text-ink-muted"}`}>{tag ?? "All tags"}</button>)}</div>}
    <p role="status" className="text-xs text-ink-muted">{visible.length} of {accounts.length} programs</p>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map(account=><AccountCard key={account.id} account={account}/>)}</div>
    {visible.length===0 && <div className="card-surface p-6"><p className="font-semibold">No programs match your filters.</p><button type="button" onClick={()=>{setQuery("");setKind("all");setTagFilter(null);}} className="mt-3 rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand">Clear filters</button></div>}
  </div>;
}
