"use client";

import { useActionState } from "react";

import { updateMembershipNumberAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function MembershipNumberForm({
  accountId,
  membershipNumber,
}: {
  accountId: string;
  membershipNumber: string;
}) {
  const [result, formAction] = useActionState(
    updateMembershipNumberAction,
    idleActionResult,
  );

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="flex gap-2">
        <input
          name="membershipNumber"
          required
          defaultValue={membershipNumber}
          className="w-full rounded-xl border border-line bg-midnight px-3 py-2 text-ink outline-none transition focus:border-brand"
        />
        <SubmitButton variant="ghost" size="sm" pendingLabel="Updating…">
          Update
        </SubmitButton>
      </div>
      <FormFeedback result={result} successMessage="Membership number updated." />
    </form>
  );
}
