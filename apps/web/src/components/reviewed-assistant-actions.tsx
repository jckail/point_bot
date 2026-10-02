"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  agentError,
  agentRequest,
  displayDate,
  requestReviewedAction,
} from "./agent-api";
import {
  canReviewAction,
  reviewActionDetails,
  reviewedActionSchema,
  type ReviewedAction,
} from "./assistant-action-contract";

import { AssistantActionRequestGate } from "./assistant-action-request-gate";

const STATUS_TEXT: Record<ReviewedAction["status"], string> = {
  pending: "Waiting for your review",
  executing: "The change is being applied. Refresh to check the result.",
  succeeded: "Change applied",
  rejected: "Rejected. No change was applied.",
  expired: "Expired. Ask for a new proposal if you still want this change.",
  failed:
    "The change could not be applied. Check your portfolio before requesting a new proposal.",
  unknown:
    "The outcome could not be confirmed. Inspect your portfolio before requesting another change. Do not retry this action.",
};
export function ReviewedAssistantActions({
  compact = false,
  refreshKey = 0,
}: {
  compact?: boolean;
  refreshKey?: number;
}) {
  const router = useRouter();
  const requestGate = useRef(new AssistantActionRequestGate());
  const reviewStatus = useRef(new Map<string, HTMLParagraphElement>());
  const reviewedId = useRef<string | null>(null);
  const refreshedSuccessIds = useRef(new Set<string>());
  const hasAcceptedRead = useRef(false);
  const [actions, setActions] = useState<ReviewedAction[] | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [blockedId, setBlockedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingId && reviewedId.current) reviewStatus.current.get(reviewedId.current)?.focus();
  }, [pendingId]);
  useEffect(() => {
    const generation = requestGate.current.beginRead();
    if (generation === null) return;
    let active = true;
    agentRequest("/api/v1/assistant/actions")
      .then((data) => {
        const result = z
          .object({ actions: z.array(reviewedActionSchema) })
          .parse(data);
        if (active && requestGate.current.canApplyRead(generation)) {
          setActions(result.actions);
          setBlockedId(null);
          // Reconcile a lost/executing review response with the canonical list
          // before refreshing server-rendered balances, goals and advice.
          const succeeded = result.actions.filter(action => action.status === "succeeded");
          if ((hasAcceptedRead.current || version > 0)
            && succeeded.some(action => !refreshedSuccessIds.current.has(action.id))) {
            for (const action of succeeded) refreshedSuccessIds.current.add(action.id);
            router.refresh();
          }
          hasAcceptedRead.current = true;
        }
      })
      .catch((err) => {
        if (active && requestGate.current.canApplyRead(generation))
          setError(agentError(err));
      });
    return () => {
      active = false;
    };
  }, [version, refreshKey, router]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  async function review(
    action: ReviewedAction,
    decision: "approve" | "reject",
  ) {
    if (pendingId || blockedId === action.id || !canReviewAction(action, now))
      return;
    if (!requestGate.current.beginReview()) return;
    setPendingId(action.id);
    setError(null);
    try {
      const result = z
        .object({ action: reviewedActionSchema })
        .parse(await requestReviewedAction(action.id, decision));
      setActions((current) =>
        (current ?? []).map((item) =>
          item.id === action.id ? result.action : item,
        ),
      );
      if (result.action.status === "succeeded") {
        refreshedSuccessIds.current.add(result.action.id);
        router.refresh();
      }
    } catch (err) {
      setBlockedId(action.id);
      setError(agentError(err));
    } finally {
      requestGate.current.finishReview();
      reviewedId.current = action.id;
      setPendingId(null);
    }
  }
  if (compact && actions?.length === 0 && !error) return null;
  return (
    <section
      id={compact ? undefined : "review-actions"}
      className={
        compact
          ? "space-y-3 rounded-xl border border-line bg-surface p-3"
          : "card-surface flex flex-col gap-4 p-4 sm:p-6"
      }
      aria-label="Proposed account changes"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          className={`font-display font-semibold ${compact ? "text-sm" : "text-xl"}`}
        >
          Changes to review
        </h2>
        <button
          type="button"
          disabled={!!pendingId}
          onClick={() => {
            setError(null);
            setVersion((value) => value + 1);
          }}
          className="rounded-lg px-2 py-1.5 text-xs font-semibold text-brand"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs leading-5 text-ink-muted">
        Review the exact values below. Approving applies this one change to your
        PointUp portfolio.
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {actions === null ? (
        <p role="status" className="text-xs text-ink-muted">
          {error
            ? "Changes could not be loaded. Refresh to try again."
            : "Loading proposed changes…"}
        </p>
      ) : actions.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No changes are waiting for review. Supported proposals appear here
          when the assistant prepares them.
        </p>
      ) : (
        <ul className="space-y-4">
          {actions.map((action) => {
            const expired =
              action.status === "pending" && !canReviewAction(action, now);
            const ready =
              canReviewAction(action, now) && blockedId !== action.id;
            return (
              <li key={action.id} className="rounded-xl border border-line p-3">
                <h3 className="text-sm font-semibold">
                  {action.kind === "manual_balance"
                    ? "Record a balance"
                    : "Create a trip goal"}
                </h3>
                <dl
                  className={`mt-3 grid gap-3 text-sm ${compact ? "" : "sm:grid-cols-2"}`}
                >
                  {reviewActionDetails(action).map((detail) => (
                    <div key={detail.label}>
                      <dt className="text-ink-muted">{detail.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium">
                        {detail.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-ink-muted">
                  Review before {displayDate(action.expiresAt)}
                </p>
                <p
                  ref={node => { if (node) reviewStatus.current.set(action.id, node); else reviewStatus.current.delete(action.id); }}
                  tabIndex={-1}
                  role="status"
                  className={`mt-2 text-xs ${action.status === "succeeded" ? "text-positive" : action.status === "unknown" || action.status === "failed" ? "text-danger" : "text-ink-muted"}`}
                >
                  {blockedId === action.id
                    ? "Result unconfirmed. Refresh the list before taking another action."
                    : expired
                      ? STATUS_TEXT.expired
                      : STATUS_TEXT[action.status]}
                </p>
                {ready && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!!pendingId}
                      onClick={() => { void review(action, "approve"); }}
                      className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {pendingId === action.id
                        ? "Saving…"
                        : action.kind === "manual_balance"
                          ? "Approve balance update"
                          : "Approve trip goal"}
                    </button>
                    <button
                      type="button"
                      disabled={!!pendingId}
                      onClick={() => { void review(action, "reject"); }}
                      className="rounded-lg border border-line px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      Reject change
                    </button>
                  </div>
                )}
                {action.status === "succeeded" ||
                action.status === "unknown" ||
                action.status === "executing" ? (
                  <a
                    href="/dashboard"
                    className="mt-3 inline-block text-xs font-semibold text-brand underline"
                  >
                    Inspect your portfolio
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
