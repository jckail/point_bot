import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentTokenControls } from "@/components/agent-token-controls";
import { CaptureConsentControls } from "@/components/capture-consent-controls";
import { BalanceObservationReviews } from "@/components/balance-observation-reviews";
import { ReviewedAssistantActions } from "@/components/reviewed-assistant-actions";
import { getContainer } from "@/server/container";
import { ChatGptIdentitySettings } from "@/components/chatgpt-identity-settings";

export const metadata: Metadata = { title: "Account settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ chatgpt?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");
  const { chatgpt } = await searchParams;
  const accounts =
    await getContainer().useCases.listLoyaltyAccounts.execute(userId);
  const captureAccounts = accounts.map((account) => ({
    id: account.id,
    providerId: account.provider.id,
    name: account.provider.displayName,
    membershipHint: `Member ending ${account.membershipNumber.slice(-4)}`,
    currentPoints: account.latestBalance?.points ?? null,
  }));
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-10 sm:px-6">
      <Link href="/dashboard" className="text-sm font-semibold text-brand">
        Back to your portfolio
      </Link>
      <div>
        <h1 className="font-display text-3xl font-bold">
          Agents &amp; account access
        </h1>
        <p className="mt-2 text-ink-muted">
          Choose what agents may do, limit capture access, and review proposed
          changes.
        </p>
      </div>
      <nav className="dashboard-nav" aria-label="Account access sections">
        <a href="#assistant-actions">Proposed changes</a>
        <a href="#balance-reviews">Captured balances</a>
        <a href="#agent-tokens">Agent tokens</a>
        <a href="#capture-consent">Capture consent</a>
        <a href="#connected-identities">Identities</a>
      </nav>
      <ReviewedAssistantActions />
      <BalanceObservationReviews accounts={captureAccounts} />
      <AgentTokenControls />
      <CaptureConsentControls accounts={captureAccounts} />
      <div id="connected-identities">
        <ChatGptIdentitySettings
          callbackStatus={
            chatgpt === "linked" || chatgpt === "error" ? chatgpt : undefined
          }
        />
      </div>
    </main>
  );
}
