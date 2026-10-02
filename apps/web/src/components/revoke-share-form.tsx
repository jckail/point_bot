"use client";

import { useActionState } from "react";

import { revokePortfolioShareAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function RevokeShareForm({ shareId, label }: { shareId: string; label: string }) {
  const [result, formAction] = useActionState(revokePortfolioShareAction, idleActionResult);

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="shareId" value={shareId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Revoking…" aria-label={`Revoke ${label}`}>
        Revoke
      </SubmitButton>
      <FormFeedback result={result} successMessage="Share link revoked." />
    </form>
  );
}
