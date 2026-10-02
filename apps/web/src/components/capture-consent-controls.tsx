"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { agentError, agentRequest, displayDate } from "./agent-api";
import {
  consentSchema,
  type CaptureAccount,
  type ConsentDto,
} from "./agent-controls-contract";

export function CaptureConsentControls({
  accounts,
}: {
  accounts: CaptureAccount[];
}) {
  const [consents, setConsents] = useState<ConsentDto[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [days, setDays] = useState(7);
  useEffect(() => {
    let active = true;
    agentRequest("/api/v1/agents/consents")
      .then((data) => {
        const result = z.array(consentSchema).parse(data);
        if (active) setConsents(result);
      })
      .catch((err) => {
        if (active) setError(agentError(err));
      });
    return () => {
      active = false;
    };
  }, [version]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  async function grant(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = consentSchema.parse(
        await agentRequest("/api/v1/agents/consents", {
          method: "POST",
          body: JSON.stringify({
            accountId,
            expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
          }),
        }),
      );
      setConsents((current) => [
        result,
        ...(current ?? []).filter((consent) => consent.id !== result.id),
      ]);
      setNotice("Capture consent granted for the selected account.");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(agentError(err));
    } finally {
      setPending(false);
    }
  }
  async function revoke(id: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      z.object({ revoked: z.literal(true) }).parse(
        await agentRequest(
          `/api/v1/agents/consents/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        ),
      );
      setVersion((value) => value + 1);
      setNotice("Capture consent revoked.");
    } catch (err) {
      setError(agentError(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      id="capture-consent"
      className="card-surface flex flex-col gap-5 p-4 sm:p-6"
      aria-labelledby="consent-title"
    >
      <div>
        <h2 id="consent-title" className="font-display text-xl font-semibold">
          Balance capture consent
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-6 text-ink-muted">
          Allow captured balances for one linked account for up to 30 days.
          Valid observations may update balance history automatically; unusual
          changes are held for your review. Capture also requires a token with
          permission to submit balances.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-positive">
          {notice}
        </p>
      )}
      {accounts.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Link a program on your dashboard before granting capture consent.
        </p>
      ) : (
        <form onSubmit={grant} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Account
              <select
                required
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="rounded-xl border border-line bg-midnight px-3 py-2.5"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                    {account.membershipHint
                      ? ` · ${account.membershipHint}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Allow capture for days
              <input
                type="number"
                required
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="rounded-xl border border-line bg-midnight px-3 py-2.5"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={pending || !accountId}
            className="self-start rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Allow balance capture"}
          </button>
        </form>
      )}
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Granted consents</h3>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setVersion((value) => value + 1);
            }}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-brand"
          >
            Refresh
          </button>
        </div>
        {consents === null ? (
          <p role="status" className="mt-3 text-sm text-ink-muted">
            {error
              ? "Consents could not be loaded. Refresh to try again."
              : "Loading consents…"}
          </p>
        ) : consents.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            No capture consent granted. Your linked programs remain available
            for manual updates.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {consents.map((consent) => {
              const account = accounts.find(
                (item) => item.id === consent.accountId,
              );
              return (
                <li
                  key={consent.id}
                  className="flex flex-wrap justify-between gap-3 rounded-xl border border-line p-4"
                >
                  <div>
                    <h4 className="font-semibold">
                      {account?.name ?? consent.providerId}
                      {account?.membershipHint
                        ? ` · ${account.membershipHint}`
                        : ""}
                    </h4>
                    <p className="mt-1 text-xs text-ink-muted">
                      {consent.revokedAt
                        ? `Revoked ${displayDate(consent.revokedAt)}`
                        : `${new Date(consent.expiresAt).getTime() <= now ? "Expired" : "Expires"} ${displayDate(consent.expiresAt)}`}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Account-specific capture permission
                    </p>
                  </div>
                  {!consent.revokedAt && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => revoke(consent.id)}
                      className="self-start rounded-lg border border-danger/30 px-3 py-2 text-sm font-semibold text-danger"
                    >
                      Revoke consent
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
