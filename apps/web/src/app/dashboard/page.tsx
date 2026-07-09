import { auth, currentUser } from "@clerk/nextjs/server";
import {
  computePortfolioSummary,
  PROVIDER_KINDS,
  type ProviderKind,
} from "@pointup/core";
import { type Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { syncAllLoyaltyAccountsAction } from "@/app/actions";
import { AccountGrid } from "@/components/account-grid";
import { ActivityFeed } from "@/components/activity-feed";
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
import { Button } from "@/components/ui/button";
import { formatPoints, formatUsdFromCents } from "@/lib/format";
import { getContainer } from "@/server/container";
import { toValueAdviceDto } from "@pointup/core/contracts";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const KIND_STAT_LABELS: Record<ProviderKind, string> = {
  airline: "Airline miles",
  hotel: "Hotel points",
  credit_card: "Credit card points",
  rail: "Rail points",
  shopping: "Shopping rewards",
};

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await currentUser();
  const { useCases } = getContainer();
  const accounts = await useCases.listLoyaltyAccounts.execute(userId);
  const summary = computePortfolioSummary(accounts);
  const [activity, expiring, goals, deleted, shares, valueAdvice] =
    await Promise.all([
      useCases.listActivity.execute(userId, 12),
      useCases.listExpiringAccounts.execute(userId, 90),
      useCases.listTripGoals.execute(userId),
      useCases.listDeletedLoyaltyAccounts.execute(userId),
      useCases.listPortfolioShares.execute(userId),
      useCases.getValueAdvice.execute(userId),
    ]);
  const providers = useCases.listProviders.execute();
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
            <form action={syncAllLoyaltyAccountsAction}>
              <Button type="submit" size="sm">
                Sync all programs
              </Button>
            </form>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Points tracked"
          value={formatPoints(summary.totalPoints)}
          hint="Sum of latest balances"
        />
        <StatCard
          label="Estimated value"
          value={formatUsdFromCents(summary.totalValueCents)}
          hint="At editorial cents-per-point"
        />
        <StatCard
          label="Last sync"
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
              : "No syncs yet"
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

      {accounts.length === 0 && <DemoPortfolioCta />}

      {accounts.length > 0 && <AccountGrid accounts={accounts} />}

      <RecentlyUnlinked accounts={deleted} />
      <ExpiryWarnings accounts={expiring} />
      {accounts.length > 0 && <ValueDealsSection initialAdvice={adviceDto} />}
      <TripGoalsSection goals={goals} accounts={accounts} />
      <ActivityFeed events={activity} />

      {accounts.length > 0 && (
        <SharePortfolioSection shares={shares} baseUrl={baseUrl} />
      )}

      <LinkAccountForm providers={availableProviders} />
      <ImportPortfolioForm />
      <AssistantPanel />
    </main>
  );
}
