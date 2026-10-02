"use client";

import type { ProviderReadModel } from "@pointup/core";
// Client components import runtime values through the pure domain subpath so
// the server-side core (drizzle, postgres) never enters the client bundle.
import { PROVIDER_KIND_LABELS, PROVIDER_KINDS } from "@pointup/core/providers";
import { useActionState, useState } from "react";

import { linkLoyaltyAccountAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function LinkAccountForm({
  providers,
}: {
  providers: ProviderReadModel[];
}) {
  const [result, formAction] = useActionState(
    linkLoyaltyAccountAction,
    idleActionResult,
  );

  const [selectedId, setSelectedId] = useState(providers[0]?.id ?? "");
  const selected = providers.find((provider) => provider.id === selectedId) ?? providers[0];
  const capabilities = selected?.capabilities;
  const ambiguousUnit = capabilities?.balanceUnit === "ambiguous";

  if (!selected) return null;

  return (
    <section className="card-surface p-6">
      <h2 className="font-display text-lg font-semibold text-ink">
        Link a program
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Add your membership number, then keep your balance current with manual
        updates or reviewed page capture. Linking does not enable automatic sync.
      </p>

      <form
        action={formAction}
        onSubmit={(event) => { if (ambiguousUnit) event.preventDefault(); }}
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-ink-muted">
          Program
          <select
            name="providerId"
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
            className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition focus:border-brand"
          >
            {PROVIDER_KINDS.map((kind) => {
              const group = providers.filter(
                (provider) => provider.kind === kind,
              );
              if (group.length === 0) return null;
              return (
                <optgroup key={kind} label={PROVIDER_KIND_LABELS[kind]}>
                  {group.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.displayName}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-ink-muted">
          Membership number
          <input
            name="membershipNumber"
            disabled={ambiguousUnit}
            required
            placeholder="e.g. MP12345678"
            className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
          />
        </label>
        {ambiguousUnit ? (
          <p className="flex-1 text-sm text-ink-muted">
            Choose the actual points payout program, such as Amex Membership Rewards or Bilt Rewards.
          </p>
        ) : <SubmitButton pendingLabel="Linking…">Link account</SubmitButton>}
      </form>
      <div className="mt-4 rounded-xl border border-line bg-midnight p-4 text-sm text-ink-muted" aria-live="polite">
        <p className="font-medium text-ink">Balance updates for {selected.displayName}</p>
        {ambiguousUnit ? (
          <p className="mt-2">Cash-back amounts in USD cannot be recorded as points. PointUp does not yet track this program&apos;s payout currencies.</p>
        ) : (
          <>
            <p className="mt-2">After linking, record your available {selected.pointsCurrency} balance manually.</p>
            {capabilities?.collectionMethods.includes("page_capture") && (
              <p className="mt-2">Reviewed page capture is also supported: sign in on the official site, grant capture consent, and confirm the proposed balance before saving.</p>
            )}
          </>
        )}
        {capabilities && <p className="mt-2">{capabilities.balanceGuidance}</p>}
        <p className="mt-2">Automatic updates require a verified connection for this program and account.</p>
        {capabilities?.officialAccountUrl && (
          <a className="mt-3 inline-block font-medium text-brand hover:underline" href={capabilities.officialAccountUrl} target="_blank" rel="noopener noreferrer">
            Open official program site <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>
      <div className="mt-3">
        <FormFeedback result={result} successMessage="Program linked." />
      </div>
    </section>
  );
}
