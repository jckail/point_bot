"use client";

import { useActionState } from "react";

import {
  createAccessTokenAction,
  grantConsentAction,
  revokeAccessTokenAction,
  resolveReviewAction,
  revokeConsentAction,
  type CreateTokenResult,
} from "@/app/agent-actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";
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
  createdAt: Date;
};
export type PendingReviewRow = {
  id: string;
  providerName: string;
  agent: string;
  sourceHost: string;
  points: number;
  previousPoints: number | null;
  expiresAt: Date;
};

const SCOPE_HELP: Record<string, string> = {
  "portfolio:read": "Read balances, goals, advice",
  "portfolio:write": "Link accounts, record balances, goals",
  "observations:write": "Agents may write balances read from provider sites (still needs consent)",
  "consents:manage": "Revoke consents only. Agents can never grant consent; only you can, here.",
};
function PendingReview({ review }: { review: PendingReviewRow }) {
  const [result, action] = useActionState(resolveReviewAction, idleActionResult);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line px-3 py-3 text-sm">
      <p className="text-ink">
        <span className="font-medium">{review.providerName}</span>:{" "}
        <strong>{review.points.toLocaleString("en-US")}</strong>
        {review.previousPoints !== null && (
          <span className="text-ink-muted"> (currently {review.previousPoints.toLocaleString("en-US")})</span>
        )}
      </p>
      <p className="text-xs text-ink-faint">
        Reported by {review.agent} via {review.sourceHost}. Not saved until you confirm. Expires {formatDateTime(review.expiresAt)}.
      </p>
      <form action={action} className="flex gap-2">
        <input type="hidden" name="reviewId" value={review.id} />
        <button type="submit" name="decision" value="confirm" className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-midnight">
          Confirm
        </button>
        <button type="submit" name="decision" value="reject" className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink">
          Reject
        </button>
      </form>
      <FormFeedback result={result} successMessage="Done." />
    </li>
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

  return (
    <div className="flex flex-col gap-6">
      {pendingReviews.length > 0 && (
        <section className="card-surface flex flex-col gap-3 p-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Pending review</h2>
            <p className="mt-1 text-sm text-ink-muted">
              These readings looked implausible, so they were held. Check them against the
              provider site, then confirm or reject. Agents cannot do this for you.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {pendingReviews.map((review) => (
              <PendingReview key={review.id} review={review} />
            ))}
          </ul>
        </section>
      )}

      <section className="card-surface flex flex-col gap-4 p-6">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Consent for agents</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Agents (Claude, ChatGPT, scripts) can read a program&apos;s balance from your own
            signed-in browser and save it here only while a consent is active. Nothing is
            written without one, and you can revoke it instantly.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {consents.filter((c) => c.active).map((consent) => (
            <li key={consent.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm">
              <span className="text-ink">
                {consent.providerName}{" "}
                <span className="text-ink-faint">until {formatDate(consent.expiresAt)}</span>
              </span>
              <form action={revokeConsentAction}>
                <input type="hidden" name="consentId" value={consent.id} />
                <button type="submit" className="text-xs font-medium text-ink-faint transition hover:text-ink">
                  Revoke
                </button>
              </form>
            </li>
          ))}
          {!consents.some((c) => c.active) && (
            <li className="text-sm text-ink-faint">No active consents - agents are read-only.</li>
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
            <input name="days" type="number" min={1} max={90} defaultValue={30} className={input} />
          </label>
          <SubmitButton pendingLabel="Granting…">Allow agents</SubmitButton>
        </form>
        <FormFeedback result={consentResult} successMessage="Consent granted." />
      </section>

      <section className="card-surface flex flex-col gap-4 p-6">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Access tokens</h2>
          <p className="mt-1 text-sm text-ink-muted">
            For the MCP server, the Claude plugin, and ChatGPT Actions. MCP endpoint:{" "}
            <code className="text-brand-soft">{mcpUrl}</code>
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {tokens.filter((t) => !t.revokedAt).map((token) => (
            <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {token.name} <code className="text-xs text-ink-faint">{token.displayPrefix}…</code>
                </p>
                <p className="text-xs text-ink-faint">
                  {token.scopes.join(", ")} · {token.lastUsedAt ? `used ${formatDateTime(token.lastUsedAt)}` : "never used"}
                  {token.expiresAt ? ` · expires ${formatDate(token.expiresAt)}` : ""}
                </p>
              </div>
              <form action={revokeAccessTokenAction}>
                <input type="hidden" name="tokenId" value={token.id} />
                <button type="submit" className="text-xs font-medium text-ink-faint transition hover:text-ink">
                  Revoke
                </button>
              </form>
            </li>
          ))}
        </ul>

        {created.status === "created" && (
          <div role="status" className="rounded-xl border border-positive/40 p-3 text-sm">
            <p className="font-medium text-positive">Copy your token now - it won&apos;t be shown again.</p>
            <code className="mt-1 block break-all text-ink">{created.secret}</code>
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
                <input type="checkbox" name="scopes" value={scope} defaultChecked={DEFAULT_SCOPES.has(scope)} className="mt-1" />
                <span><code className="text-ink">{scope}</code> - {help}</span>
              </label>
            ))}
          </fieldset>
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink-muted sm:w-48">
            Expires (days)
            <input name="ttlDays" type="number" min={1} max={365} defaultValue={90} className={input} />
          </label>
          <div><SubmitButton pendingLabel="Creating…">Create token</SubmitButton></div>
        </form>
        {created.status === "error" && <FormFeedback result={created} successMessage="" />}
      </section>

      <section className="card-surface flex flex-col gap-3 p-6">
        <h2 className="font-display text-lg font-semibold text-ink">What agents did</h2>
        {observations.length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {observations.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 text-ink-muted">
                <span>
                  <span className="text-ink">{o.providerName}</span> {o.points.toLocaleString("en-US")} · {o.outcome} · {o.agent} via {o.sourceHost}
                </span>
                <span className="text-xs text-ink-faint">{formatDateTime(o.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
