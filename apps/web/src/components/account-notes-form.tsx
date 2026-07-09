"use client";

import type { LoyaltyAccountReadModel } from "@pointup/core";
import { useActionState } from "react";

import { updateAccountNotesAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function AccountNotesForm({
  account,
}: {
  account: LoyaltyAccountReadModel;
}) {
  const [result, formAction] = useActionState(
    updateAccountNotesAction,
    idleActionResult,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="accountId" value={account.id} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-muted">
        Notes
        <textarea
          name="notes"
          rows={3}
          defaultValue={account.notes ?? ""}
          maxLength={2000}
          placeholder="e.g. Primary card for transfers"
          className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-muted">
        Tags
        <input
          name="tags"
          defaultValue={account.tags.join(", ")}
          placeholder="work, personal, transferable"
          className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
        />
        <span className="text-xs font-normal text-ink-faint">
          Comma-separated. Used to filter the dashboard.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save notes</SubmitButton>
        <FormFeedback result={result} successMessage="Saved." />
      </div>
    </form>
  );
}
