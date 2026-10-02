"use client";

import { useActionState } from "react";
import { syncAllLoyaltyAccountsAction, syncLoyaltyAccountAction, type SyncActionResult } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

/** Shared individual/bulk feedback; capability labels stay server supplied. */
export function SyncBalanceForm({ accountId, label }: { accountId?: string; label: string }) {
  const [result, action] = useActionState<SyncActionResult, FormData>(
    accountId ? syncLoyaltyAccountAction : syncAllLoyaltyAccountsAction,
    idleActionResult,
  );
  return (
    <form action={action} className="flex min-w-0 flex-col items-start gap-2">
      {accountId && <input type="hidden" name="accountId" value={accountId} />}
      <SubmitButton variant={accountId ? "secondary" : "primary"} size="sm" pendingLabel={accountId ? "Syncing…" : "Syncing programs…"}>
        {label}
      </SubmitButton>
      <FormFeedback result={result} successMessage={result.message ?? "Balance updated."} />
    </form>
  );
}
