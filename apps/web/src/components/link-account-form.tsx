"use client";

import type { ProviderReadModel } from "@pointup/core";
// Client components import runtime values through the pure domain subpath so
// the server-side core (drizzle, postgres) never enters the client bundle.
import { PROVIDER_KIND_LABELS, PROVIDER_KINDS } from "@pointup/core/providers";
import { CARD_PRODUCTS } from "@pointup/core/card-products";
import { useActionState, useState } from "react";

import { linkLoyaltyAccountAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function LinkAccountForm({
  providers,
}: {
  providers: ProviderReadModel[];
}) {
  const firstProvider = PROVIDER_KINDS.flatMap(kind => providers.filter(provider => provider.kind === kind))[0];
  const [providerId, setProviderId] = useState(firstProvider?.id ?? "");
  const products = CARD_PRODUCTS.filter(product => product.providerId === providerId);
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
        Add a membership number to track a program. Linking does not sign in to the provider or fetch a balance. You can record a balance manually; automated sync depends on a configured provider connection.
      </p>

      <form
        action={formAction}
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-ink-muted">
          Program
          <select
            name="providerId"
            value={providerId}
            onChange={event => setProviderId(event.target.value)}
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
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-ink-muted">
          Membership number
          <input
            name="membershipNumber"
            required
            placeholder="e.g. MP12345678"
            className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
          />
        </label>
        {products.length > 0 && (
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-ink-muted">
            Card used for transfers
            <select key={providerId} name="cardProductId" defaultValue="" className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none focus:border-brand">
              <option value="">Unknown / choose later</option>
              {products.map(product => <option key={product.id} value={product.id}>{product.displayName}</option>)}
            </select>
            <span className="text-xs font-normal text-ink-faint">Choose your transfer card to calculate card-specific rules. You can change it in Details.</span>
          </label>
        )}
        <SubmitButton pendingLabel="Linking…">Link account</SubmitButton>
      </form>
      <div className="mt-3">
        <FormFeedback result={result} successMessage="Program linked." />
      </div>
    </section>
  );
}
