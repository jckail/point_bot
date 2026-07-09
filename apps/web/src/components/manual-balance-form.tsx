"use client";

import { useActionState } from "react";

import { recordManualBalanceAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function ManualBalanceForm({ accountId }: { accountId: string }) {
  const [result, formAction] = useActionState(
    recordManualBalanceAction,
    idleActionResult,
  );

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="flex gap-2">
        <input
          name="points"
          type="number"
          min="0"
          step="1"
          required
          placeholder="e.g. 52000"
          className="w-full rounded-xl border border-line bg-midnight px-3 py-2 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
        />
        <SubmitButton variant="secondary" size="sm">
          Save
        </SubmitButton>
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-faint">
        As of
        <input
          name="capturedOn"
          type="date"
          max={new Date().toISOString().slice(0, 10)}
          className="rounded-lg border border-line bg-midnight px-2 py-1 text-xs text-ink-muted outline-none transition focus:border-brand"
        />
        <span>(optional - defaults to now)</span>
      </label>
      <FormFeedback result={result} successMessage="Balance recorded." />
    </form>
  );
}
