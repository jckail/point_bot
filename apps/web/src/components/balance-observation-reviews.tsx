"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { agentError, agentRequest, displayDate } from "./agent-api";
import {
  observationSchema,
  type CaptureAccount,
  type ObservationDto,
} from "./agent-controls-contract";

export function BalanceObservationReviews({
  accounts,
}: {
  accounts: CaptureAccount[];
}) {
  const router = useRouter();
  const [observations, setObservations] = useState<ObservationDto[] | null>(
    null,
  );
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewUncertain, setReviewUncertain] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    agentRequest("/api/v1/agents/observations")
      .then((data) => {
        const result = z.array(observationSchema).parse(data);
        if (active) {
          setObservations(result);
          setReviewUncertain(false);
        }
      })
      .catch((err) => {
        if (active) setError(agentError(err));
      });
    return () => {
      active = false;
    };
  }, [version]);
  async function review(id: string, decision: "approve" | "reject") {
    if (pendingId || reviewUncertain) return;
    setPendingId(id);
    setError(null);
    setNotice(null);
    try {
      const result = observationSchema.parse(
        await agentRequest(
          `/api/v1/agents/observations/${encodeURIComponent(id)}/review`,
          { method: "POST", body: JSON.stringify({ decision }) },
        ),
      );
      setObservations((current) =>
        (current ?? []).map((item) => (item.id === id ? result : item)),
      );
      setNotice(
        result.status === "accepted"
          ? "Balance accepted and recorded in your portfolio."
          : result.status === "rejected"
            ? "Captured balance rejected. Your balance was not changed."
            : "The balance is still held. Refresh the list before trying again.",
      );
      if (result.status === "accepted") router.refresh();
    } catch (err) {
      setReviewUncertain(true);
      setError(agentError(err));
    } finally {
      setPendingId(null);
    }
  }
  const held = observations?.filter((item) => item.status === "held");
  return (
    <section
      id="balance-reviews"
      className="card-surface flex flex-col gap-4 p-4 sm:p-6"
      aria-labelledby="balance-review-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="balance-review-title"
          className="font-display text-xl font-semibold"
        >
          Captured balances to review
        </h2>
        <button
          type="button"
          disabled={!!pendingId}
          onClick={() => {
            setError(null);
            setVersion((value) => value + 1);
          }}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-brand"
        >
          Refresh
        </button>
      </div>
      <p className="max-w-prose text-sm leading-6 text-ink-muted">
        These observations have not changed your balance. Compare each with the
        provider’s account page before accepting it.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {reviewUncertain && (
        <p role="status" className="text-sm leading-6 text-ink-muted">
          The review outcome is unconfirmed. Refresh to load the latest state
          before accepting or rejecting another balance.
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-positive">
          {notice}
        </p>
      )}
      {!held ? (
        <p role="status" className="text-sm text-ink-muted">
          {error
            ? "Reviews could not be loaded. Refresh to try again."
            : "Loading captured balances…"}
        </p>
      ) : held.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No captured balances are waiting for review.
        </p>
      ) : (
        <ul className="space-y-4">
          {held.map((item) => {
            const account = accounts.find(
              (value) => value.id === item.accountId,
            );
            return (
              <li
                key={item.id}
                className="rounded-xl border border-gold/30 p-4"
              >
                <h3 className="font-semibold">
                  {account?.name ?? item.providerId}
                  {account?.membershipHint
                    ? ` · ${account.membershipHint}`
                    : ""}
                </h3>
                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-y-2">
                  <dt className="text-ink-muted">Current recorded balance</dt>
                  <dd className="mb-2 min-w-0 break-words sm:mb-0">
                    {account?.currentPoints != null
                      ? `${account.currentPoints.toLocaleString("en-US")} points`
                      : "No recorded balance"}
                  </dd>
                  <dt className="text-ink-muted">Captured balance</dt>
                  <dd className="mb-2 min-w-0 font-semibold tabular-nums sm:mb-0">
                    {item.points.toLocaleString("en-US")} points
                  </dd>
                  <dt className="text-ink-muted">Captured at</dt>
                  <dd className="mb-2 min-w-0 break-words sm:mb-0">
                    {displayDate(item.capturedAt)}
                  </dd>
                  {item.sourceMethod && (
                    <>
                      <dt className="text-ink-muted">Capture method</dt>
                      <dd className="mb-2 min-w-0 break-words sm:mb-0">
                        {item.sourceMethod === "page_capture"
                          ? "Browser page"
                          : "Manual entry"}
                      </dd>
                    </>
                  )}
                  <dt className="text-ink-muted">Source</dt>
                  <dd className="mb-2 min-w-0 break-all sm:mb-0">
                    {item.sourceHost}
                  </dd>
                  {item.holdReason && (
                    <>
                      <dt className="text-ink-muted">Held because</dt>
                      <dd className="mb-2 min-w-0 break-words sm:mb-0">
                        {item.holdReason}
                      </dd>
                    </>
                  )}
                </dl>
                {!account && (
                  <p className="mt-3 text-sm text-danger">
                    This account is no longer linked. Reject this observation.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={!!pendingId || reviewUncertain || !account}
                    onClick={() => review(item.id, "approve")}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {pendingId === item.id ? "Saving…" : "Accept this balance"}
                  </button>
                  <button
                    type="button"
                    disabled={!!pendingId || reviewUncertain}
                    onClick={() => review(item.id, "reject")}
                    className="rounded-lg border border-line px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    Reject balance
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
