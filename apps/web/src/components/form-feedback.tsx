"use client";

import { useFormStatus } from "react-dom";

import type { ActionResult } from "@/lib/action-result";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Inline status line under a form driven by `useActionState`. */
export function FormFeedback({
  result,
  successMessage,
}: {
  result: ActionResult;
  successMessage: string;
}) {
  if (result.status === "idle") return null;

  return result.status === "error" ? (
    <p role="alert" className="text-sm text-danger">
      {result.message}
    </p>
  ) : (
    <p role="status" className="text-sm text-positive">
      {successMessage}
    </p>
  );
}

/** Submit button that disables itself while the action is pending. */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
