"use client";

import type { LoyaltyAccountReadModel } from "@pointup/core";
import { useMemo, useState } from "react";

import { AccountCard } from "@/components/account-card";

export function AccountGrid({
  accounts,
}: {
  accounts: LoyaltyAccountReadModel[];
}) {
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const account of accounts) {
      for (const tag of account.tags) tags.add(tag);
    }
    return [...tags].sort();
  }, [accounts]);

  const visible = tagFilter
    ? accounts.filter((account) => account.tags.includes(tagFilter))
    : accounts;

  return (
    <div className="flex flex-col gap-4">
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Filter
          </span>
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              tagFilter === null
                ? "border-brand bg-brand/10 text-brand-soft"
                : "border-line text-ink-muted hover:border-ink-faint"
            }`}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() =>
                setTagFilter((current) => (current === tag ? null : tag))
              }
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                tagFilter === tag
                  ? "border-brand bg-brand/10 text-brand-soft"
                  : "border-line text-ink-muted hover:border-ink-faint"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </div>
      {visible.length === 0 && (
        <p className="text-sm text-ink-muted">
          No programs match the &ldquo;{tagFilter}&rdquo; tag.
        </p>
      )}
    </div>
  );
}
