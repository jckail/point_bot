import type { LoyaltyAccountReadModel, ProviderSyncMode } from "@pointup/core";
import { findCardProduct } from "@pointup/core/card-products";
import Link from "next/link";

import {
  syncLoyaltyAccountAction,
  togglePinAccountAction,
} from "@/app/actions";
import { BalanceTrendChips } from "@/components/balance-trend";
import { ProviderBadge } from "@/components/provider-badge";
import { SubmitButton } from "@/components/form-feedback";
import { formatPoints, formatUsdFromCents } from "@/lib/format";

export function AccountCard({
  account,
  syncMode = "unavailable",
}: {
  account: LoyaltyAccountReadModel;
  syncMode?: ProviderSyncMode;
}) {
  return (
    <section className="card-surface account-card group flex min-w-0 flex-col gap-4 p-6 transition hover:border-brand/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-display text-lg font-semibold text-ink">
            <Link
              href={`/dashboard/accounts/${account.id}`}
              className="no-underline transition hover:text-brand-soft"
            >
              {account.pinnedAt ? "★ " : ""}
              {account.provider.displayName}
            </Link>
          </h3>
          <p className="mt-0.5 break-all text-xs text-ink-faint">
            Member #{account.membershipNumber}
          </p>
          {account.provider.id === "chase-ultimate-rewards" && <p className="mt-1 text-xs text-ink-faint">
            Transfer card: {account.cardProductId ? findCardProduct(account.cardProductId)?.displayName ?? "Unknown" : "Unknown"}
          </p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <ProviderBadge kind={account.provider.kind} />
          <form action={togglePinAccountAction}>
            <input type="hidden" name="accountId" value={account.id} />
            <input
              type="hidden"
              name="pinned"
              value={account.pinnedAt ? "false" : "true"}
            />
            <button
              type="submit"
              className="text-xs font-medium text-ink-faint transition hover:text-gold"
              aria-label={account.pinnedAt ? "Unpin program" : "Pin program"}
            >
              {account.pinnedAt ? "Unpin" : "Pin"}
            </button>
          </form>
        </div>
      </div>

      <div>
        {account.latestBalance ? (
          <>
            <p className="font-display text-3xl font-bold text-ink">
              {formatPoints(account.latestBalance.points)}
              <span className="ml-2 text-sm font-medium text-ink-muted">
                {account.provider.pointsCurrency}
              </span>
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              ~{formatUsdFromCents(account.estimatedValueCents)} · updated{" "}
              {account.latestBalance.capturedAt.toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            <div className="mt-2">
              <BalanceTrendChips trend={account.trend} />
            </div>
            {account.daysUntilExpiry !== null &&
              account.daysUntilExpiry <= 90 && (
                <p
                  className={`mt-2 text-xs font-medium ${
                    account.daysUntilExpiry < 0
                      ? "text-danger"
                      : account.daysUntilExpiry <= 30
                        ? "text-gold"
                        : "text-ink-faint"
                  }`}
                >
                  {account.daysUntilExpiry < 0
                    ? "Balance may have expired"
                    : `Expires in ${account.daysUntilExpiry} day${account.daysUntilExpiry === 1 ? "" : "s"}`}
                </p>
              )}
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            No balance yet. Open Details to record the balance you see on the provider’s site.
          </p>
        )}
        {account.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {account.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-line px-2 py-0.5 break-words text-xs text-ink-faint"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {account.notes && (
          <p className="mt-2 line-clamp-2 text-xs text-ink-muted">
            {account.notes}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {syncMode === "unavailable" ? <>
          <p className="w-full text-xs text-ink-muted">Automatic sync is unavailable. Record a balance or explore consented capture.</p>
          <Link href={`/dashboard/accounts/${account.id}#record-balance`} className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-brand no-underline">Record manually</Link>
          <Link href="/dashboard/agents#capture-consent" className="rounded-full px-3 py-1.5 text-sm font-semibold text-brand no-underline">Capture options</Link>
        </> : <>
        <p className="w-full text-xs text-ink-muted">{syncMode === "demo" ? "Demo balances are simulated." : "API configured; provider access and delivery still need verification."}</p>
        <form action={syncLoyaltyAccountAction}>
          <input type="hidden" name="accountId" value={account.id} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Syncing…">
            {syncMode === "demo" ? "Demo sync" : "Sync via API"}
          </SubmitButton>
        </form>
        </>}
        <Link
          href={`/dashboard/accounts/${account.id}`}
          className="rounded-full px-3 py-1.5 text-sm font-semibold text-ink-faint no-underline transition hover:text-ink"
        >
          Details &rarr;
        </Link>
      </div>
    </section>
  );
}
