import { ShareLinkNotFoundError } from "@pointup/core";
import { PROVIDER_KIND_LABELS } from "@pointup/core/providers";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Logo } from "@/components/logo";
import { formatPoints, formatUsdFromCents } from "@/lib/format";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  try {
    const snapshot =
      await getContainer().useCases.getPublicPortfolioSnapshot.execute(token);
    return {
      title: snapshot.label
        ? `${snapshot.label} · PointUp`
        : "Shared portfolio · PointUp",
      description: `${formatPoints(snapshot.totalPoints)} points across ${snapshot.accountCount} programs`,
    };
  } catch {
    return { title: "Shared portfolio · PointUp" };
  }
}

export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let snapshot;
  try {
    snapshot =
      await getContainer().useCases.getPublicPortfolioSnapshot.execute(token);
  } catch (error) {
    if (error instanceof ShareLinkNotFoundError) notFound();
    throw error;
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between">
        <Logo />
        <Link
          href="/"
          className="text-sm font-semibold text-ink-muted no-underline transition hover:text-ink"
        >
          Get PointUp
        </Link>
      </div>

      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          Shared portfolio
        </p>
        <h1 className="font-display mt-1 text-3xl font-bold text-ink">
          {snapshot.label ?? "Point balances"}
        </h1>
        <p className="mt-2 text-ink-muted">
          {formatPoints(snapshot.totalPoints)} points · ~
          {formatUsdFromCents(snapshot.totalValueCents)} across{" "}
          {snapshot.accountCount} program
          {snapshot.accountCount === 1 ? "" : "s"}
        </p>
      </header>

      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-midnight/40">
        {snapshot.programs.map((program) => (
          <li
            key={`${program.kind}-${program.displayName}`}
            className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4"
          >
            <div>
              <p className="font-display font-semibold text-ink">
                {program.displayName}
              </p>
              <p className="text-xs text-ink-faint">
                {PROVIDER_KIND_LABELS[program.kind]}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-lg font-bold text-ink">
                {formatPoints(program.points)}
              </p>
              <p className="text-xs text-ink-faint">
                ~{formatUsdFromCents(program.valueCents)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-center text-xs text-ink-faint">
        Membership numbers are never shared. Snapshot generated{" "}
        {snapshot.generatedAt.toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
        .
      </p>
    </main>
  );
}
