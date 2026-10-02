"use client";

import type { LoyaltyAccountReadModel } from "@pointup/core";
import { useActionState, useId } from "react";

import { updateAccountValuationAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function AccountValuationForm({ account }: { account: LoyaltyAccountReadModel }) {
  const [result, formAction] = useActionState(updateAccountValuationAction, idleActionResult);
  const fieldId = useId();
  const helpId = `${fieldId}-help`;
  const effectiveRate = account.customCentsPerPoint ?? account.provider.estimatedCentsPerPoint;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="accountId" value={account.id} />
      <p className="text-sm text-ink-muted">
        Current value: {effectiveRate}¢ per point ({account.customCentsPerPoint == null ? "catalog estimate" : "your custom valuation"}).
        {" "}Catalog estimate: {account.provider.estimatedCentsPerPoint}¢ per point.
      </p>
      <label htmlFor={fieldId} className="text-sm font-medium text-ink-muted">
        Custom value (US cents per point)
      </label>
      <input
        key={account.customCentsPerPoint ?? "catalog"}
        id={fieldId}
        name="centsPerPoint"
        type="number"
        min="0"
        max="100"
        step="any"
        required
        defaultValue={effectiveRate}
        aria-describedby={helpId}
        className="w-full rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition focus:border-brand"
      />
      <p id={helpId} className="text-xs text-ink-muted">
        Enter a positive value up to 100 cents. Saved values round to 0.001 cents and must remain above zero.
        {" "}This changes your estimated portfolio value for this program, not your points or issuer terms.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton name="intent" value="save" pendingLabel="Updating…">Save custom value</SubmitButton>
        <SubmitButton name="intent" value="reset" formNoValidate variant="ghost" pendingLabel="Updating…">Reset to catalog</SubmitButton>
      </div>
      <FormFeedback result={result} successMessage="Valuation updated." />
    </form>
  );
}
