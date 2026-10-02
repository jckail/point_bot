import {
  computePortfolioSummary,
  PROVIDER_KINDS,
  type ProviderKind,
} from "@pointup/core";
import { type Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SyncBalanceForm } from "@/components/sync-balance-form";
import { AccountGrid } from "@/components/account-grid";
import { ActivityFeed } from "@/components/activity-feed";
import { BestRedemptionsSection } from "@/components/best-redemptions-section";
import { AssistantPanel } from "@/components/assistant-panel";
import { DemoPortfolioCta } from "@/components/demo-portfolio-cta";
import { ExpiryWarnings } from "@/components/expiry-warnings";
import { ImportPortfolioForm } from "@/components/import-portfolio-form";
import { LinkAccountForm } from "@/components/link-account-form";
import { RecentlyUnlinked } from "@/components/recently-unlinked";
import { SharePortfolioSection } from "@/components/share-portfolio-section";
import { StatCard } from "@/components/stat-card";
import { TripGoalsSection } from "@/components/trip-goals-section";
import { ValueDealsSection } from "@/components/value-deals-section";
import { formatPoints, formatUsdFromCents } from "@/lib/format";
import { getSessionUser, getSessionUserId } from "@/server/auth";
import { getContainer } from "@/server/container";
import { getProviderSyncOptions } from "@/server/provider-sync";
import {
  toPlanRedemptionResultDto,
  toValueAdviceDto,
} from "@pointup/core/contracts";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const KIND_STAT_LABELS = {
  airline: "Airline miles",
  hotel: "Hotel points",
  credit_card: "Credit card points",
  rail: "Rail points",
  car_rental: "Car rental points",
  cruise: "Cruise points",
  rideshare: "Rideshare rewards",
  dining: "Dining rewards",
  shopping: "Shopping rewards",
} satisfies Record<ProviderKind, string>;

export default async function DashboardPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const user = await getSessionUser();
  const { useCases } = getContainer();
  const accounts = await useCases.listLoyaltyAccounts.execute(userId);
  const syncOptions = getProviderSyncOptions(accounts.map(account => account.provider.id));
  const summary = computePortfolioSummary(accounts);
  const [activity, expiring, goals, deleted, shares, valueAdvice, bestPlans] =
    await Promise.all([
      useCases.listActivity.execute(userId, 12),
      useCases.listExpiringAccounts.execute(userId, 90),
      useCases.listTripGoals.execute(userId),
      useCases.listDeletedLoyaltyAccounts.execute(userId),
      useCases.listPortfolioShares.execute(userId),
      useCases.getValueAdvice.execute(userId),
      useCases.listBestRedemptions.execute({ userId, limit: 4 }),
    ]);
  const providers = await useCases.listProviders.execute();
  const adviceDto = toValueAdviceDto(valueAdvice);

  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  const baseUrl = host ? `${proto}://${host}` : "http://localhost:3000";

  const linkedProviderIds = new Set(
    accounts.map((account) => account.provider.id),
  );
  const availableProviders = providers.filter(
    (provider) => !linkedProviderIds.has(provider.id),
  );

  const kindBreakdown = PROVIDER_KINDS.map(
    (kind) => [kind, summary.byKind[kind]] as const,
  ).filter(([, stats]) => stats.accounts > 0);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">
            {user?.firstName
              ? `Welcome back, ${user.firstName}`
              : "Your points"}
          </h1>
          <p className="mt-1 text-ink-muted">
            {accounts.length > 0
              ? "Here's where every program stands."
              : "Link your first loyalty program to get started."}
          </p>
        </div>
        {accounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {syncOptions.bulkLabel ? <SyncBalanceForm key={userId} label={syncOptions.bulkLabel} /> : <a href="/dashboard/agents#capture-consent" className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-brand no-underline">Capture options</a>}
            <a
              href="/api/v1/export?format=csv"
              className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-ink-muted no-underline transition hover:border-ink-faint hover:text-ink"
            >
              Download CSV
            </a>
            <a
              href="/api/v1/export?format=json"
              className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-ink-muted no-underline transition hover:border-ink-faint hover:text-ink"
            >
              Download JSON
            </a>
            <a
              href="/api/v1/calendar.ics"
              className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-ink-muted no-underline transition hover:border-ink-faint hover:text-ink"
            >
              Expiry calendar
            </a>
          </div>
        )}
      </div>

      <nav aria-label="Portfolio sections" className="dashboard-nav">
        <a href="#programs">Programs</a><a href="#opportunities">Opportunities</a><a href="#trip-goals">Trip goals</a><a href="#activity">Activity</a><a href="#manage">Manage</a>
      </nav>
      <div className="dashboard-stats">
        <StatCard
          label="Points tracked"
          value={formatPoints(summary.totalPoints)}
          hint="Sum of latest balances"
        />
        <StatCard
          label="Estimated value"
          value={formatUsdFromCents(summary.totalValueCents)}
          hint="Your valuations or editorial estimates"
        />
        <StatCard
          label="Last balance update"
          value={
            summary.lastSyncedAt
              ? summary.lastSyncedAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              : "-"
          }
          hint={
            summary.lastSyncedAt
              ? summary.lastSyncedAt.toLocaleTimeString("en-US", {
                  timeStyle: "short",
                })
              : "No balances yet"
          }
        />
        {kindBreakdown.map(([kind, stats]) => (
          <StatCard
            key={kind}
            label={KIND_STAT_LABELS[kind]}
            value={formatPoints(stats.points)}
            hint={`${stats.accounts} program${stats.accounts === 1 ? "" : "s"} · ~${formatUsdFromCents(stats.valueCents)}`}
          />
        ))}
      </div>

      <section id="programs" className="dashboard-section flex flex-col gap-5" aria-labelledby="programs-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="programs-heading" className="font-display text-2xl font-semibold text-ink">Your programs</h2><p className="mt-1 text-sm text-ink-muted">Balances, expiry dates and memberships in one place.</p></div>
          <a href="#link-program" className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-brand no-underline">Link a program</a>
        </div>
        {accounts.length === 0 ? <><div className="card-surface p-6"><p className="font-semibold text-ink">Start with a program you already use.</p><p className="mt-2 text-sm text-ink-muted">Link its membership number, then record the balance you see on the provider’s site.</p></div><DemoPortfolioCta /></> : <AccountGrid accounts={accounts} syncModes={syncOptions.modes} />}
      </section>
      <section id="opportunities" className="dashboard-section flex flex-col gap-8" aria-label="Points opportunities">
        <ExpiryWarnings accounts={expiring} />
        {accounts.length > 0 ? <><BestRedemptionsSection result={toPlanRedemptionResultDto(bestPlans)} /><ValueDealsSection initialAdvice={adviceDto} /></> : <p className="text-sm text-ink-muted">Add a balance to explore redemption estimates and expiry reminders.</p>}
      </section>
      <div id="trip-goals" className="dashboard-section"><TripGoalsSection goals={goals} accounts={accounts} /></div>
      <div id="activity" className="dashboard-section"><ActivityFeed events={activity} /></div>
      <section id="manage" className="dashboard-section flex flex-col gap-6" aria-labelledby="manage-heading">
        <div><h2 id="manage-heading" className="font-display text-2xl font-semibold text-ink">Manage your portfolio</h2><p className="mt-1 text-sm text-ink-muted">Link programs, import existing balances, share totals or restore recently unlinked memberships.</p></div>
        <div id="link-program" className="dashboard-section"><LinkAccountForm providers={availableProviders} /></div>
        <ImportPortfolioForm />
        {(accounts.length > 0 || shares.some(share => share.active)) && <SharePortfolioSection shares={shares} baseUrl={baseUrl} />}
        <RecentlyUnlinked accounts={deleted} />
      </section>
      <AssistantPanel key={userId} ownerScope={userId} />
    </main>
  );
}
