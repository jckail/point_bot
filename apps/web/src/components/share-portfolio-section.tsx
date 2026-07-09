"use client";

import { useActionState } from "react";

import {
  createPortfolioShareAction,
  revokePortfolioShareAction,
} from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";
import { formatDate } from "@/lib/format";

type ShareRow = {
  id: string;
  token: string;
  label: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
};

export function SharePortfolioSection({
  shares,
  baseUrl,
}: {
  shares: ShareRow[];
  baseUrl: string;
}) {
  const [result, formAction] = useActionState(
    createPortfolioShareAction,
    idleActionResult,
  );

  const active = shares.filter((share) => share.active);

  return (
    <section className="card-surface flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">
          Share snapshot
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Privacy-preserving link — totals and program names only, no membership
          numbers.
        </p>
      </div>

      {active.length > 0 && (
        <ul className="flex flex-col gap-2">
          {active.map((share) => {
            const url = `${baseUrl}/share/${share.token}`;
            return (
              <li
                key={share.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {share.label ?? "Untitled share"}
                  </p>
                  <a
                    href={url}
                    className="truncate text-xs text-brand-soft no-underline hover:underline"
                  >
                    {url}
                  </a>
                  {share.expiresAt && (
                    <p className="text-xs text-ink-faint">
                      Expires {formatDate(share.expiresAt)}
                    </p>
                  )}
                </div>
                <form action={revokePortfolioShareAction}>
                  <input type="hidden" name="shareId" value={share.id} />
                  <button
                    type="submit"
                    className="text-xs font-medium text-ink-faint transition hover:text-ink"
                  >
                    Revoke
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-ink-muted">
          Label
          <input
            name="label"
            placeholder="e.g. Friends & family"
            maxLength={80}
            className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
          />
        </label>
        <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink-muted sm:w-36">
          Expires (days)
          <input
            name="expiresInDays"
            type="number"
            min={1}
            max={365}
            placeholder="30"
            className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
          />
        </label>
        <SubmitButton pendingLabel="Creating…">Create link</SubmitButton>
      </form>
      <FormFeedback result={result} successMessage="Share link created." />
    </section>
  );
}
