"use client";

import type { AccessTokenScope } from "@pointup/core";
import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";

import {
  createAccessTokenAction,
  grantConsentAction,
  revokeAccessTokenAction,
  resolveReviewAction,
  revokeConsentAction,
  type CreateTokenResult,
} from "@/app/agent-actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult, type ActionResult } from "@/lib/action-result";
import { formatDate, formatDateTime } from "@/lib/format";

export type TokenRow = {
  id: string;
  name: string;
  displayPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};
export type ConsentRow = {
  id: string;
  providerId: string;
  providerName: string;
  expiresAt: Date;
  active: boolean;
};
export type ObservationRow = {
  id: string;
  providerName: string;
  agent: string;
  sourceHost: string;
  points: number;
  outcome: string;
  observedAt: Date;
  createdAt: Date;
};
export type PendingReviewRow = {
  id: string;
  providerName: string;
  agent: string;
  sourceHost: string;
  points: number;
  previousPoints: number | null;
  observedAt: Date;
  createdAt: Date;
  expiresAt: Date;
};

const SCOPE_HELP = {
  "portfolio:read": "Read balances, goals, advice",
  "portfolio:write": "Link accounts, record balances, goals",
  "observations:write": "Agents may write balances read from provider sites (still needs consent)",
  "consents:manage": "Revoke consents only. Agents can never grant consent; only you can, here.",
} satisfies Record<AccessTokenScope, string>;
function formatCaptureTime(date: Date): string {
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "long", timeZone: "UTC" });
}

type RemovalTicket = {
  sequence: number;
  id: string;
  message: string;
  form: HTMLFormElement | null;
};

type RemovalFeedback = {
  begin: (id: string, message: string, form: HTMLFormElement | null, initiatedWithinForm: boolean) => RemovalTicket;
  complete: (ticket: RemovalTicket) => void;
  cancel: (ticket: RemovalTicket) => void;
};

type FocusLedger = {
  begin: (form: HTMLFormElement | null, initiatedWithinForm: boolean) => number;
  consume: (sequence: number) => boolean;
  cancel: (sequence: number) => void;
};

/** One active handoff across all three sections, invalidated by later user intent. */
function useRemovalFocusLedger(): FocusLedger {
  const next = useRef(0);
  const mounted = useRef(true);
  const active = useRef<{ sequence: number; form: HTMLFormElement } | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    active.current = null;
    detach.current?.();
    detach.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);
  const begin = useCallback((form: HTMLFormElement | null, initiatedWithinForm: boolean) => {
    stop(); // A newer dispatch in any section supersedes the previous handoff.
    const sequence = ++next.current;
    if (!mounted.current || !form || !initiatedWithinForm) return sequence;
    active.current = { sequence, form };
    const pointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !form.contains(event.target)) stop();
    };
    // Any subsequent key is explicit interaction; the initiating submit key has already fired.
    const key = () => stop();
    const focus = (event: FocusEvent) => {
      // Removing/disabling the original control can automatically leave focus on body.
      if (event.target !== document.body && (!(event.target instanceof Node) || !form.contains(event.target))) stop();
    };
    const blur = () => stop();
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus, true);
    window.addEventListener("blur", blur);
    detach.current = () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus, true);
      window.removeEventListener("blur", blur);
    };
    return sequence;
  }, [stop]);
  const cancel = useCallback((sequence: number) => {
    if (active.current?.sequence === sequence) stop();
  }, [stop]);
  const consume = useCallback((sequence: number) => {
    if (active.current?.sequence !== sequence) return false;
    stop();
    return true;
  }, [stop]);
  return { begin, consume, cancel };
}

/** Remains mounted after authoritative revalidation removes an action row. */
function useRemovalFeedback(presentIds: readonly string[], ledger: FocusLedger) {
  const target = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  const focusedSequence = useRef(0);
  const [outcome, setOutcome] = useState<RemovalTicket | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const { begin: beginFocus, consume: consumeFocus, cancel: cancelFocus } = ledger;
  const begin = useCallback((id: string, message: string, form: HTMLFormElement | null, initiatedWithinForm: boolean) => {
    const ticket = {
      sequence: beginFocus(form, initiatedWithinForm), id, message, form,
    };
    if (mounted.current) setOutcome(null);
    return ticket;
  }, [beginFocus]);
  const complete = useCallback((ticket: RemovalTicket) => {
    if (!mounted.current) return;
    // An older completion must not overwrite a newer completed interaction.
    setOutcome(current => current && current.sequence > ticket.sequence ? current : ticket);
  }, []);
  const cancel = useCallback((ticket: RemovalTicket) => cancelFocus(ticket.sequence), [cancelFocus]);
  useEffect(() => {
    if (!outcome || presentIds.includes(outcome.id) || focusedSequence.current >= outcome.sequence) return;
    focusedSequence.current = outcome.sequence;
    // Announce genuine success, but never take focus from a newer interaction.
    if (!consumeFocus(outcome.sequence) || !document.hasFocus()) return;
    const active = document.activeElement;
    if (active === document.body || outcome.form?.contains(active)) target.current?.focus();
  }, [outcome, presentIds, consumeFocus]);
  return { begin, complete, cancel, target, message: outcome?.message ?? "" };
}

/** Notify outside the disappearing row; a row effect could be unmounted first. */
function useRemovalAction(
  serverAction: (previous: ActionResult, data: FormData) => Promise<ActionResult>,
  id: string,
  message: (data: FormData) => string,
  feedback: RemovalFeedback,
) {
  const form = useRef<HTMLFormElement>(null);
  const submittedFocus = useRef<boolean | null>(null);
  const onSubmit = useCallback(() => {
    // Capture before React disables the submit control for its pending state.
    submittedFocus.current = form.current?.contains(document.activeElement) ?? false;
  }, []);
  const { begin, complete, cancel } = feedback;
  const action = useCallback(async (previous: ActionResult, data: FormData) => {
    const withinForm = submittedFocus.current ?? (form.current?.contains(document.activeElement) ?? false);
    submittedFocus.current = null;
    const ticket = begin(id, message(data), form.current, withinForm);
    try {
      const result = await serverAction(previous, data);
      if (result.status === "success") complete(ticket);
      else cancel(ticket);
      return result;
    } catch (error) {
      cancel(ticket);
      throw error;
    }
  }, [serverAction, id, message, begin, complete, cancel]);
  const [result, formAction] = useActionState(action, idleActionResult);
  return { form, result, formAction, onSubmit };
}

function PendingReview({ review, feedback }: { review: PendingReviewRow; feedback: RemovalFeedback }) {
  const message = useCallback((data: FormData) => `${review.providerName} reading captured ${formatCaptureTime(review.observedAt)} ${data.get("decision") === "confirm" ? "confirmed" : "rejected"}.`, [review.providerName, review.observedAt]);
  const { form, result, formAction, onSubmit } = useRemovalAction(resolveReviewAction, review.id, message, feedback);
  const contextId = useId();
  const summaryId = `${contextId}-summary`;
  const capturedId = `${contextId}-captured`;
  const confirmId = `${contextId}-confirm`;
  const rejectId = `${contextId}-reject`;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-midnight px-4 py-4 text-sm">
      <p id={summaryId} className="text-ink">
        <span className="font-medium">{review.providerName}</span>:{" "}
        <strong>{review.points.toLocaleString("en-US")}</strong>
        {review.previousPoints !== null && (
          <span className="text-ink-muted"> (previous balance {review.previousPoints.toLocaleString("en-US")})</span>
        )}
      </p>
      <p className="break-words text-sm leading-6 text-ink-muted">
        Reported by {review.agent} via {review.sourceHost}. Not saved until you confirm. Expires {formatDateTime(review.expiresAt)}.
      </p>
      <div className="text-sm leading-6 text-ink-muted">
        <p id={capturedId}>Captured: <time dateTime={review.observedAt.toISOString()}>{formatCaptureTime(review.observedAt)}</time></p>
        <p>Submitted: <time dateTime={review.createdAt.toISOString()}>{formatCaptureTime(review.createdAt)}</time></p>
      </div>
      <form ref={form} onSubmit={onSubmit} action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="reviewId" value={review.id} />
        <SubmitButton id={confirmId} aria-labelledby={`${confirmId} ${summaryId} ${capturedId}`} name="decision" value="confirm" size="sm" pendingLabel="Saving decision…">Confirm balance</SubmitButton>
        <SubmitButton id={rejectId} aria-labelledby={`${rejectId} ${summaryId} ${capturedId}`} name="decision" value="reject" size="sm" variant="ghost" pendingLabel="Saving decision…">Reject balance</SubmitButton>
      </form>
      {result.status === "error" && <FormFeedback result={result} successMessage="" />}
    </li>
  );
}

function RevokeAccessForm({
  action,
  idField,
  id,
  label,
  successMessage,
  feedback,
}: {
  action: (previous: ActionResult, data: FormData) => Promise<ActionResult>;
  idField: "tokenId" | "consentId";
  id: string;
  label: string;
  successMessage: string;
  feedback: RemovalFeedback;
}) {
  const message = useCallback(() => successMessage, [successMessage]);
  const { form, result, formAction, onSubmit } = useRemovalAction(action, id, message, feedback);
  return (
    <form ref={form} onSubmit={onSubmit} action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name={idField} value={id} />
      <SubmitButton variant="ghost" size="sm" pendingLabel="Revoking…" aria-label={label}>Revoke</SubmitButton>
      {result.status === "error" && <FormFeedback result={result} successMessage="" />}
    </form>
  );
}

const DEFAULT_SCOPES = new Set(["portfolio:read", "portfolio:write", "observations:write"]);

const input =
  "rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none transition placeholder:text-ink-faint focus:border-brand";

export function AgentsPanel({
  tokens,
  consents,
  observations,
  pendingReviews,
  providers,
  mcpUrl,
}: {
  tokens: TokenRow[];
  consents: ConsentRow[];
  observations: ObservationRow[];
  pendingReviews: PendingReviewRow[];
  providers: { id: string; name: string }[];
  mcpUrl: string;
}) {
  const [created, createAction] = useActionState<CreateTokenResult, FormData>(
    createAccessTokenAction,
    idleActionResult,
  );
  const [consentResult, consentAction] = useActionState(grantConsentAction, idleActionResult);
  const tokenSecretId = useId();
  const tokenSecretHelpId = `${tokenSecretId}-help`;
  const removalFocus = useRemovalFocusLedger();
  const reviewFeedback = useRemovalFeedback(pendingReviews.map(review => review.id), removalFocus);
  const consentFeedback = useRemovalFeedback(consents.filter(consent => consent.active).map(consent => consent.id), removalFocus);
  const tokenFeedback = useRemovalFeedback(tokens.filter(token => !token.revokedAt).map(token => token.id), removalFocus);

  return (
    <div className="flex flex-col gap-6">
      <section id="balance-reviews" aria-labelledby="balance-reviews-title" className="card-surface flex flex-col gap-3 p-6">
          <div>
            <h2 id="balance-reviews-title" className="font-display text-xl font-semibold text-ink">Captured balances to review</h2>
            <p className="mt-1 text-sm text-ink-muted">
              These readings looked implausible, so they were held. Check them against the
              provider site, then confirm or reject. Agents cannot do this for you.
            </p>
          </div>
          <p ref={reviewFeedback.target} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} className="text-sm text-positive">{reviewFeedback.message}</p>
          {pendingReviews.length === 0 && <p className="text-sm text-ink-muted">No captured balances are waiting for your review.</p>}
          <ul className="flex flex-col gap-2">
            {pendingReviews.map((review) => (
              <PendingReview key={review.id} review={review} feedback={reviewFeedback} />
            ))}
          </ul>
      </section>

      <section id="capture-consent" aria-labelledby="capture-consent-title" className="card-surface flex flex-col gap-4 p-6">
        <div>
          <h2 id="capture-consent-title" className="font-display text-xl font-semibold text-ink">Program capture consent</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Agents (Claude, ChatGPT, scripts) can read a program&apos;s balance from your own
            signed-in browser and save it here only while a consent is active. Nothing is
            written without one, and you can revoke it instantly.
          </p>
        </div>
        <p ref={consentFeedback.target} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} className="text-sm text-positive">{consentFeedback.message}</p>
        <ul className="flex flex-col gap-2">
          {consents.filter((c) => c.active).map((consent) => (
            <li key={consent.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-3 py-3 text-sm">
              <span className="text-ink">
                {consent.providerName}{" "}
                <span className="text-ink-faint">until {formatDate(consent.expiresAt)}</span>
              </span>
              <RevokeAccessForm
                action={revokeConsentAction}
                idField="consentId"
                id={consent.id}
                label={`Revoke ${consent.providerName} capture consent`}
                successMessage={`${consent.providerName} capture consent revoked.`}
                feedback={consentFeedback}
              />
            </li>
          ))}
          {!consents.some((c) => c.active) && (
            <li className="text-sm text-ink-faint">No active capture consents. Allow a program before an agent submits a balance for it.</li>
          )}
        </ul>
        <form action={consentAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-ink-muted">
            Program
            <select name="providerId" className={input} required>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink-muted sm:w-32">
            Days (1-90)
            <input name="days" type="number" min={1} max={90} step={1} required defaultValue={30} className={input} />
          </label>
          <SubmitButton pendingLabel="Granting…">Allow agents</SubmitButton>
        </form>
        <FormFeedback result={consentResult} successMessage="Consent granted." />
      </section>

      <section id="agent-tokens" aria-labelledby="agent-tokens-title" className="card-surface flex flex-col gap-4 p-6">
        <div>
          <h2 id="agent-tokens-title" className="font-display text-xl font-semibold text-ink">Agent access tokens</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Use a token for the Chrome extension, MCP, Claude, or ChatGPT Actions. Give it only the access you need. MCP endpoint:{" "}
            <code className="break-all text-brand">{mcpUrl}</code>
          </p>
        </div>
        <p ref={tokenFeedback.target} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} className="text-sm text-positive">{tokenFeedback.message}</p>
        <ul className="flex flex-col gap-2">
          {tokens.filter((t) => !t.revokedAt).map((token) => (
            <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="break-words font-medium text-ink">
                  {token.name} <code className="text-xs text-ink-faint">{token.displayPrefix}…</code>
                </p>
                <p className="break-words text-xs leading-6 text-ink-faint">
                  {token.scopes.join(", ")} · {token.lastUsedAt ? `used ${formatDateTime(token.lastUsedAt)}` : "never used"}
                  {token.expiresAt ? ` · expires ${formatDate(token.expiresAt)}` : ""}
                </p>
              </div>
              <RevokeAccessForm
                action={revokeAccessTokenAction}
                idField="tokenId"
                id={token.id}
                label={`Revoke ${token.name} token`}
                successMessage={`${token.name} token revoked.`}
                feedback={tokenFeedback}
              />
            </li>
          ))}
        </ul>

        {!tokens.some(token => !token.revokedAt) && <p className="text-sm text-ink-muted">No active tokens. Create one below when you are ready to connect an agent.</p>}

        {/* A confirmed revocation hides only that token's one-time result.
            A different token's revocation or a failed request must preserve it. */}
        {created.status === "created" && !tokens.some(token => token.id === created.tokenId && token.revokedAt !== null) && (
          <div role="status" className="rounded-xl border border-positive/40 p-3 text-sm">
            <p className="font-medium text-positive">Copy your token now - it won&apos;t be shown again.</p>
            <label htmlFor={tokenSecretId} className="mt-3 block font-medium text-ink">Token (shown once)</label>
            <input
              id={tokenSecretId}
              type="text"
              readOnly
              value={created.secret}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={tokenSecretHelpId}
              onFocus={event => event.currentTarget.select()}
              className={`${input} mt-1 w-full font-mono text-sm`}
            />
            <p id={tokenSecretHelpId} className="mt-2 text-xs text-ink-muted">Keep this token private. Focus the field to select it, then copy with your keyboard.</p>
          </div>
        )}

        <form action={createAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-muted">
            Name
            <input name="name" required maxLength={80} placeholder="e.g. Claude Code on my laptop" className={input} />
          </label>
          <fieldset className="flex flex-col gap-1.5 text-sm text-ink-muted">
            <legend className="mb-1 font-medium">Scopes</legend>
            {Object.entries(SCOPE_HELP).map(([scope, help]) => (
              <label key={scope} className="flex items-start gap-2">
                <input type="checkbox" name="scopes" value={scope} defaultChecked={DEFAULT_SCOPES.has(scope)} className="mt-1 accent-[var(--color-brand)]" />
                <span><code className="text-ink">{scope}</code> - {help}</span>
              </label>
            ))}
          </fieldset>
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink-muted sm:w-48">
            Expires (days, 1–365)
            <input name="ttlDays" type="number" min={1} max={365} step={1} required defaultValue={90} className={input} />
          </label>
          <div><SubmitButton pendingLabel="Creating…">Create token</SubmitButton></div>
        </form>
        {created.status === "error" && <FormFeedback result={created} successMessage="" />}
      </section>

      <section id="capture-history" aria-labelledby="capture-history-title" className="card-surface flex flex-col gap-3 p-6">
        <h2 id="capture-history-title" className="font-display text-xl font-semibold text-ink">Capture history</h2>
        <p className="text-sm leading-6 text-ink-muted">Submitted readings and their outcomes. Agent names and source hosts describe what was reported; held or rejected readings do not update a balance.</p>
        {observations.length === 0 ? (
          <p className="text-sm text-ink-faint">No agent readings yet. Submitted captures will appear here.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {observations.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 text-ink-muted">
                <span className="min-w-0 break-words">
                  <span className="text-ink">{o.providerName}</span> {o.points.toLocaleString("en-US")} · {o.outcome} · {o.agent} via {o.sourceHost}
                </span>
                <span className="flex flex-col text-xs leading-5 text-ink-faint">
                  <span>Captured: <time dateTime={o.observedAt.toISOString()}>{formatCaptureTime(o.observedAt)}</time></span>
                  <span>Submitted: <time dateTime={o.createdAt.toISOString()}>{formatCaptureTime(o.createdAt)}</time></span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
