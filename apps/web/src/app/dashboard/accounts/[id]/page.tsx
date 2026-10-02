import { getSessionUserId } from "@/server/auth";
import { LoyaltyAccountId, LoyaltyAccountNotFoundError } from "@pointup/core";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  syncLoyaltyAccountAction,
  togglePinAccountAction,
  unlinkLoyaltyAccountAction,
} from "@/app/actions";
import { AccountCardProductForm } from "@/components/account-card-product-form";
import { AccountNotesForm } from "@/components/account-notes-form";
import { ManualBalanceForm } from "@/components/manual-balance-form";
import { MembershipNumberForm } from "@/components/membership-number-form";
import { BalanceTrendChips } from "@/components/balance-trend";
import { ProviderBadge } from "@/components/provider-badge";
import { Sparkline } from "@/components/sparkline";
import { SubmitButton } from "@/components/form-feedback";
import { formatPoints, formatUsdFromCents } from "@/lib/format";
import { getContainer } from "@/server/container";
import { getProviderSyncOptions } from "@/server/provider-sync";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";


export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const { id } = await params;
  const { useCases } = getContainer();

  let account, history;
  try {
    account = await useCases.getLoyaltyAccount.execute(userId, LoyaltyAccountId.parse(id));
    history = await useCases.getBalanceHistory.execute(userId, LoyaltyAccountId.parse(id), 90);
  } catch (error) {
    if (error instanceof LoyaltyAccountNotFoundError) notFound();
    throw error;
  }

  // Sparkline wants oldest → newest.
  const chartValues = [...history].reverse().map((entry) => entry.points);
  const syncMode = getProviderSyncOptions([account.provider.id]).modes[account.provider.id] ?? "unavailable";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/dashboard"
          className="text-sm text-ink-faint no-underline transition hover:text-ink-muted"
        >
          &larr; Back to dashboard
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="break-words font-display text-3xl font-bold text-ink">
            {account.pinnedAt ? "★ " : ""}
            {account.provider.displayName}
          </h1>
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
              className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-muted transition hover:border-gold hover:text-gold"
            >
              {account.pinnedAt ? "Unpin" : "Pin to top"}
            </button>
          </form>
        </div>
        <p className="break-all text-ink-muted">
          Member #{account.membershipNumber}
          {account.hasStoredCredential && " · credential vault connected"}
        </p>
      </div>

      {/* Balance overview */}
      <section className="card-surface flex flex-col gap-6 p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink-faint">
              Current balance
            </p>
            <p className="font-display mt-1 text-4xl font-bold text-ink">
              {account.latestBalance
                ? formatPoints(account.latestBalance.points)
                : "-"}
              <span className="ml-2 text-base font-medium text-ink-muted">
                {account.provider.pointsCurrency}
              </span>
            </p>
            {account.latestBalance && (
              <>
                <p className="mt-1 text-xs text-ink-faint">
                  ~{formatUsdFromCents(account.estimatedValueCents)} at{" "}
                  {account.provider.estimatedCentsPerPoint}&cent;/pt · updated{" "}
                  {account.latestBalance.capturedAt.toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  · {account.latestBalance.source === "sync" ? "synced" : account.latestBalance.source === "agent" ? "agent capture" : "manual entry"}
                </p>
                <div className="mt-3">
                  <BalanceTrendChips trend={account.trend} />
                </div>
              </>
            )}
          </div>
          {syncMode === "unavailable" ? <div className="flex flex-col gap-2 text-sm">
            <p className="text-ink-muted">Automatic sync is unavailable for this program.</p>
            <Link href="#record-balance" className="font-semibold text-brand no-underline">Record a balance manually</Link>
            <Link href="/dashboard/agents#capture-consent" className="font-semibold text-brand no-underline">Explore consented capture</Link>
          </div> : <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-ink-muted">{syncMode === "demo" ? "Demo balances are simulated." : "API configured; provider access and delivery still need verification."}</p>
          <form action={syncLoyaltyAccountAction}>
            <input type="hidden" name="accountId" value={account.id} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Syncing…">
              {syncMode === "demo" ? "Demo sync" : "Sync via API"}
            </SubmitButton>
          </form>
          </div>}
        </div>

        {chartValues.length >= 2 ? (
          <Sparkline values={chartValues} />
        ) : (
          <p className="text-sm text-ink-faint">
            Balance history will chart here after two recorded balances.
          </p>
        )}
      </section>

      {/* History + manual entry */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card-surface p-6">
          <h2 className="font-display text-lg font-semibold text-ink">
            History
          </h2>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No entries yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {history.slice(0, 8).map((entry) => (
                <li
                  key={entry.capturedAt.toISOString()}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <span className="text-ink">
                    {formatPoints(entry.points)}
                    <span className="ml-1.5 text-xs text-ink-faint">
                      {entry.source}
                    </span>
                  </span>
                  <span className="text-ink-faint">
                    {entry.capturedAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card-surface flex flex-col gap-5 p-6">
          <div id="record-balance" className="dashboard-section">
            <h2 className="font-display text-lg font-semibold text-ink">
              Record a balance
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Saw your balance on the provider&apos;s site? Key it in.
            </p>
            <ManualBalanceForm accountId={account.id} />
          </div>

          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Membership number
            </h2>
            <MembershipNumberForm
              accountId={account.id}
              membershipNumber={account.membershipNumber}
            />
          </div>

          {account.provider.id === "chase-ultimate-rewards" && (
            <div id="transfer-card">
              <h2 className="font-display text-lg font-semibold text-ink">Transfer card</h2>
              <AccountCardProductForm key={account.cardProductId ?? "unknown"} account={account} />
            </div>
          )}

          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Notes &amp; tags
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Keep context on this membership and filter it on the dashboard.
            </p>
            <div className="mt-3">
              <AccountNotesForm account={account} />
            </div>
          </div>
        </section>
      </div>

      {/* Danger zone */}
      <section className="card-surface flex flex-wrap items-center justify-between gap-4 border-danger/20 p-6">
        <div>
          <h2 className="font-display font-semibold text-ink">
            Unlink this program
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Soft-deletes for 7 days so you can undo. After that, history is
            purged. Your points with {account.provider.displayName} are
            unaffected.
          </p>
        </div>
        <form action={unlinkLoyaltyAccountAction}>
          <input type="hidden" name="accountId" value={account.id} />
          <SubmitButton variant="danger" size="sm" pendingLabel="Unlinking…">
            Unlink account
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
