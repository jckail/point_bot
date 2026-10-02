"use client";

import { useActionState } from "react";

import { deleteTripGoalAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function RemoveGoalForm({
  goalId,
  goalTitle,
}: {
  goalId: string;
  goalTitle: string;
}) {
  const [result, formAction] = useActionState(deleteTripGoalAction, idleActionResult);

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="goalId" value={goalId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Removing…" aria-label={`Remove ${goalTitle}`}>
        Remove
      </SubmitButton>
      <FormFeedback result={result} successMessage="Goal removed." />
    </form>
  );
}
