"use client";

import { useActionState } from "react";

import { importPortfolioAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function ImportPortfolioForm() {
  const [result, formAction] = useActionState(
    importPortfolioAction,
    idleActionResult,
  );

  return (
    <section className="card-surface p-6">
      <h2 className="font-display text-lg font-semibold text-ink">
        Import CSV
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Paste a PointUp export to re-link programs and restore balance history.
      </p>
      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-muted">
          CSV contents
          <textarea
            name="csv"
            required
            rows={5}
            placeholder="accountId,providerId,providerKind,..."
            className="rounded-xl border border-line bg-midnight px-3 py-2.5 font-mono text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
          <FormFeedback
            result={result}
            successMessage="Import complete."
          />
        </div>
      </form>
    </section>
  );
}
