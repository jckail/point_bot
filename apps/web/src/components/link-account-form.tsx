"use client";

import type { ProviderReadModel } from "@pointup/core";
// Client components import runtime values through the pure domain subpath so
// the server-side core (drizzle, postgres) never enters the client bundle.
import { PROVIDER_KIND_LABELS, PROVIDER_KINDS } from "@pointup/core/providers";
import { useActionState } from "react";

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

  if (providers.length === 0) return null;

  return (
    <section className="card-surface p-6">
      <h2 className="font-display text-lg font-semibold text-ink">
        Link a program
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Add a membership by number. Connect credentials later from a vault you
        control - PointUp never stores passwords.
      </p>

      <form
        action={formAction}
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-ink-muted">
          Program
          <select
            name="providerId"
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
            required
            placeholder="e.g. MP12345678"
            className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
          />
        </label>
        <SubmitButton pendingLabel="Linking…">Link account</SubmitButton>
      </form>
      <div className="mt-3">
        <FormFeedback result={result} successMessage="Program linked." />
      </div>
    </section>
  );
}
