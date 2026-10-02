import { getSessionUserId } from "@/server/auth";
import { PROVIDER_CATALOG, reviewExpiresAt } from "@pointup/core";
import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AgentsPanel } from "@/components/agents-panel";
import { ReviewedAssistantActions } from "@/components/reviewed-assistant-actions";
import { getContainer } from "@/server/container";

export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const { listAccessTokens, listConsents, listAgentObservations } =
    getContainer().useCases;
  const [tokens, consents, observations] = await Promise.all([
    listAccessTokens.execute(userId),
    listConsents.execute(userId),
    listAgentObservations.execute(userId, 100),
  ]);
  const now = new Date();
  const pendingReviews = observations.filter(
    (o) => o.outcome === "needs_review" && reviewExpiresAt(o) > now,
  );
  const name = (id: string) =>
    PROVIDER_CATALOG.find((p) => p.id === id)?.displayName ?? id;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <Link href="/dashboard" className="text-sm text-ink-faint no-underline hover:text-ink">
          ← Dashboard
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Agents</h1>
        <p className="mt-1 text-ink-muted">
          Connect Claude, ChatGPT, or your own scripts - with consent you control.
        </p>
      </div>
      <AgentsPanel
        tokens={tokens.map((t) => ({ ...t, scopes: [...t.scopes] }))}
        consents={consents.map((c) => ({
          id: c.id,
          providerId: c.providerId,
          providerName: name(c.providerId),
          expiresAt: c.expiresAt,
          active: c.active,
        }))}
        observations={observations.slice(0, 20).map((o) => ({
          id: o.id,
          providerName: name(o.providerId),
          agent: o.agent,
          sourceHost: o.sourceHost,
          points: o.points,
          outcome: o.outcome,
          createdAt: o.createdAt,
        }))}
        pendingReviews={pendingReviews.map((o) => ({
          id: o.id,
          providerName: name(o.providerId),
          agent: o.agent,
          sourceHost: o.sourceHost,
          points: o.points,
          previousPoints: o.previousPoints,
          expiresAt: reviewExpiresAt(o),
        }))}
        providers={PROVIDER_CATALOG.map((p) => ({ id: p.id, name: p.displayName }))}
        mcpUrl={process.env.NEXT_PUBLIC_MCP_URL ?? "http://localhost:8787/mcp"}
      />
      <ReviewedAssistantActions />
    </main>
  );
}
