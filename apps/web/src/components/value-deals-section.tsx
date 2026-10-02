"use client";

import { findCardProduct } from "@pointup/core/card-products";
import type { RankedDealDto, TransferOptionDto, ValueAdviceDto } from "@pointup/core/contracts";
import { useState, useTransition } from "react";

import { TransferEligibilityWarnings } from "@/components/transfer-eligibility-warnings";
import { formatPoints, formatUsdFromCents } from "@/lib/format";

export function ValueDealsSection({
  initialAdvice,
}: {
  initialAdvice: ValueAdviceDto;
}) {
  const [importedAdvice, setImportedAdvice] = useState<{ base: ValueAdviceDto; advice: ValueAdviceDto } | null>(null);
  const advice = importedAdvice?.base === initialAdvice ? importedAdvice.advice : initialAdvice;
  const [url, setUrl] = useState("");
  const [scrapeNote, setScrapeNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function scrape() {
    setError(null);
    setScrapeNote(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/v1/deals/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const payload = (await response.json()) as {
          ingest?: { pageTitle: string; deals: unknown[] };
          advice?: ValueAdviceDto;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Scrape failed");
        }
        if (payload.advice) setImportedAdvice({ base: initialAdvice, advice: payload.advice });
        setScrapeNote(
          `Ingested “${payload.ingest?.pageTitle ?? "page"}” · ${payload.ingest?.deals.length ?? 0} deal(s) extracted`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Scrape failed");
      }
    });
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">
          Value &amp; deals
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Explore transfer estimates and curated redemptions using your balances. Import a public deal page to compare options when page import is configured. Confirm prices and availability with the provider before transferring.
        </p>
      </div>

      <TransferEligibilityWarnings warnings={advice.eligibilityWarnings ?? []} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold text-ink-faint">
            Top transfers
          </h3>
          {advice.transfers.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              Link a transferable card currency to see ranked partners.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {advice.transfers.slice(0, 6).map((option) => (
                <TransferRow key={`${option.fromProviderId}-${option.toProviderId}-${option.sourcePoints}`} option={option} />
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold text-ink-faint">
            Ranked redemptions
          </h3>
          {advice.deals.length === 0 && <p className="mt-3 text-sm text-ink-muted">No ranked redemptions yet. Record a balance or import a supported public deal page.</p>}
          <ul className="mt-3 flex flex-col gap-2">
            {advice.deals.slice(0, 6).map((ranked) => (
              <DealRow key={ranked.deal.id} ranked={ranked} />
            ))}
          </ul>
        </div>
      </div>

      <form
        aria-busy={pending}
        className="flex flex-col gap-2 rounded-2xl border border-dashed border-line p-4 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          scrape();
        }}
      >
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-ink-muted">
          Import a public deal or award-chart URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            required
            placeholder="https://…"
            className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none focus:border-brand"
          />
        </label>
        <button
          type="submit"
          disabled={pending || url.trim().length === 0}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Importing…" : "Import & rank"}
        </button>
      </form>
      {scrapeNote && <p role="status" className="text-xs text-ink-faint">{scrapeNote}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  );
}

function TransferRow({ option }: { option: TransferOptionDto }) {
  return (
    <li className="rounded-xl border border-line/80 px-3 py-2 text-sm">
      <p className="break-words font-medium text-ink">
        {option.fromDisplayName} → {option.toDisplayName}
        {option.bonusMultiplier > 1 ? (
          <span className="ml-2 text-xs text-gold">
            {Math.round((option.bonusMultiplier - 1) * 100)}% bonus
            {option.bonusVerified !== true ? " · unverified" : ""}
          </span>
        ) : null}
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">
        {formatPoints(option.sourcePoints)} →{" "}
        {formatPoints(option.destinationPoints)} · ~
        {option.effectiveCentsPerPoint}¢/pt · ~
        {formatUsdFromCents(option.estimatedValueCents)}
      </p>
      {option.eligibility?.sourceUrl && (
        <p className="mt-0.5 text-[11px] text-ink-faint">
          {option.eligibility.cardProductId ? `${findCardProduct(option.eligibility.cardProductId)?.displayName ?? "Selected card"}: ` : ""}Base ratio {option.ratioFrom}:{option.ratioTo}{option.eligibility.effectiveFrom ? ` from ${option.eligibility.effectiveFrom.slice(0, 10)}` : ""}{" · "}
          <a href={option.eligibility.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Issuer terms</a>
        </p>
      )}
      {option.bonusLabel && (
        <p className="mt-0.5 text-[11px] text-ink-faint">{option.bonusLabel}</p>
      )}
      {option.bonusMultiplier > 1 && option.bonusSource && (
        <p className="mt-0.5 text-[11px] text-ink-faint">Bonus source: {option.bonusSource}</p>
      )}
    </li>
  );
}

function DealRow({ ranked }: { ranked: RankedDealDto }) {
  return (
    <li className="rounded-xl border border-line/80 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="break-words font-medium text-ink">{ranked.deal.title}</p>
        {ranked.realizedCentsPerPoint != null && (
          <span className="text-xs font-semibold text-gold">
            {ranked.realizedCentsPerPoint}¢/pt
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-ink-muted">{ranked.deal.summary}</p>
      <p
        className={`mt-1 text-[11px] ${
          ranked.affordable ? "text-brand-soft" : "text-ink-faint"
        }`}
      >
        {ranked.affordabilityNote}
        {ranked.deal.pointsCost != null
          ? ` · ${formatPoints(ranked.deal.pointsCost)} pts`
          : ""}
        {ranked.deal.cashEquivalentCents != null
          ? ` · ~${formatUsdFromCents(ranked.deal.cashEquivalentCents)}`
          : ""}
      </p>
    </li>
  );
}
