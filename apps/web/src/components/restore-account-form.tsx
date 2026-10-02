"use client";

import { useActionState } from "react";

import { restoreLoyaltyAccountAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function RestoreAccountForm({
  accountId,
  providerName,
}: {
  accountId: string;
  providerName: string;
}) {
  const [result, formAction] = useActionState(
    restoreLoyaltyAccountAction,
    idleActionResult,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <SubmitButton
        variant="ghost"
        size="sm"
        pendingLabel="Restoring…"
        aria-label={`Restore ${providerName}`}
      >
        Restore
      </SubmitButton>
      <FormFeedback result={result} successMessage={`${providerName} restored.`} />
    </form>
  );
}
