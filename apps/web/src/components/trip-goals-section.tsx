"use client";

import type { TripGoalReadModel } from "@pointup/core";
import type { LoyaltyAccountReadModel } from "@pointup/core";
import { useActionState } from "react";

import {
  createTripGoalAction,
  deleteTripGoalAction,
} from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { formatPoints } from "@/lib/format";
import { idleActionResult } from "@/lib/action-result";

export function TripGoalsSection({
  goals,
  accounts,
}: {
  goals: TripGoalReadModel[];
  accounts: LoyaltyAccountReadModel[];
}) {
  const [createResult, createAction] = useActionState(
    createTripGoalAction,
    idleActionResult,
  );

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">
          Trip goals
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Set a target balance and track progress across linked programs.
        </p>
      </div>

      {goals.length > 0 && (
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => (
            <li
              key={goal.id}
              className="rounded-2xl border border-line bg-midnight/40 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-semibold text-ink">
                      {goal.title}
                    </h3>
                    <span className="text-xs uppercase tracking-wide text-ink-faint">
                      {goal.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {formatPoints(goal.currentPoints)} /{" "}
                    {formatPoints(goal.targetPoints)}
                    {goal.targetDate ? ` · by ${goal.targetDate}` : ""}
                    {goal.achieved ? " · reached" : ""}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-brand transition-[width]"
                      style={{
                        width: `${Math.min(100, goal.percentComplete)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">
                    {goal.percentComplete}% complete
                    {goal.remainingPoints > 0
                      ? ` · ${formatPoints(goal.remainingPoints)} to go`
                      : ""}
                  </p>
                </div>
                {goal.status !== "archived" && (
                  <form action={deleteTripGoalAction}>
                    <input type="hidden" name="goalId" value={goal.id} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-ink-faint transition hover:text-ink"
                    >
                      Remove
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {accounts.length > 0 && (
        <form
          action={createAction}
          className="flex flex-col gap-3 rounded-2xl border border-dashed border-line p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-muted">
              Goal title
              <input
                name="title"
                required
                maxLength={120}
                placeholder="e.g. Kyoto Hyatt stay"
                className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-muted">
              Target points
              <input
                name="targetPoints"
                type="number"
                required
                min={1}
                step={1}
                placeholder="80000"
                className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-muted">
              Target date
              <input
                name="targetDate"
                type="date"
                className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition focus:border-brand"
              />
            </label>
            <fieldset className="flex flex-col gap-1.5 text-sm font-medium text-ink-muted">
              <legend>Count balances from</legend>
              <div className="mt-1 flex max-h-28 flex-col gap-1 overflow-y-auto rounded-xl border border-line bg-midnight px-3 py-2">
                {accounts.map((account) => (
                  <label
                    key={account.id}
                    className="flex items-center gap-2 text-sm font-normal text-ink"
                  >
                    <input
                      type="checkbox"
                      name="accountIds"
                      value={account.id}
                      className="accent-[var(--brand)]"
                    />
                    {account.provider.displayName}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="flex items-center gap-3">
            <SubmitButton pendingLabel="Saving…">Add goal</SubmitButton>
            <FormFeedback
              result={createResult}
              successMessage="Goal saved."
            />
          </div>
        </form>
      )}
    </section>
  );
}
