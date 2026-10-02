"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { agentError, agentRequest, displayDate } from "./agent-api";
import { SCOPES, tokenSchema, type TokenDto } from "./agent-controls-contract";

export function AgentTokenControls() {
  const [tokens, setTokens] = useState<TokenDto[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [scopes, setScopes] = useState<string[]>(["portfolio:read"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    agentRequest("/api/v1/agents/tokens")
      .then((data) => {
        const result = z.array(tokenSchema).parse(data);
        if (active) setTokens(result);
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
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (pending || secret) return;
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const data = await agentRequest("/api/v1/agents/tokens", {
        method: "POST",
        body: JSON.stringify({
          label: label.trim(),
          scopes,
          expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
        }),
      });
      const result = z
        .object({ token: z.string().min(1), metadata: tokenSchema })
        .parse(data);
      setSecret(result.token);
      setLabel("");
      setTokens((current) => [result.metadata, ...(current ?? [])]);
    } catch (err) {
      setError(agentError(err));
    } finally {
      setPending(false);
    }
  }
  async function revoke(id: string) {
    setPending(true);
    setError(null);
    try {
      z.object({ revoked: z.literal(true) }).parse(
        await agentRequest(`/api/v1/agents/tokens/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      );
      setVersion((value) => value + 1);
    } catch (err) {
      setError(agentError(err));
    } finally {
      setPending(false);
    }
  }
  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError(
        "Copy was unavailable. Select the token below and copy it manually.",
      );
    }
  }
  return (
    <section
      id="agent-tokens"
      className="card-surface flex flex-col gap-5 p-4 sm:p-6"
      aria-labelledby="tokens-title"
    >
      <div>
        <h2 id="tokens-title" className="font-display text-xl font-semibold">
          Agent access tokens
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-6 text-ink-muted">
          Give an external agent only the permissions it needs, for up to 90
          days. A token with update permissions can change your portfolio
          directly. Proposed changes still require your review.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {secret && (
        <div className="rounded-xl border border-brand bg-brand/5 p-4">
          <h3 className="font-semibold">Save this token now</h3>
          <p className="mt-1 text-sm text-ink-muted">
            This is the only time PointUp shows the full token. Keep it in your
            agent’s credential store.
          </p>
          <input
            aria-label="New agent token"
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            value={secret}
            className="mt-3 w-full rounded-lg border border-line bg-surface p-3 font-mono text-xs"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={copy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
            >
              {copied ? "Copied" : "Copy token"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSecret(null);
                setCopied(false);
              }}
              className="rounded-lg border border-line px-4 py-2 text-sm font-semibold"
            >
              I saved the token
            </button>
          </div>
        </div>
      )}
      <form onSubmit={create} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Token name
            <input
              required
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="For example, my travel agent"
              className="rounded-xl border border-line bg-midnight px-3 py-2.5"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Expires in days
            <input
              type="number"
              min={1}
              max={90}
              required
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-xl border border-line bg-midnight px-3 py-2.5"
            />
          </label>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Permissions</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCOPES.map((scope) => (
              <label
                key={scope.value}
                className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(scope.value)}
                  onChange={(e) =>
                    setScopes((current) =>
                      e.target.checked
                        ? [...current, scope.value]
                        : current.filter((value) => value !== scope.value),
                    )
                  }
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
                />
                <span>
                  <span className="font-medium">{scope.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-ink-muted">
                    {scope.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {scopes.includes("portfolio:write") && (
          <p className="rounded-xl border border-gold/30 bg-gold-soft/20 p-3 text-sm leading-6">
            Update portfolio allows direct changes to memberships, balances, and
            goals. For approval-only access, leave Update portfolio unchecked and
            choose Propose account changes.
          </p>
        )}
        {copied && (
          <p role="status" className="text-sm text-positive">
            Token copied. Save it in your agent’s credential store.
          </p>
        )}
        <button
          type="submit"
          disabled={pending || scopes.length === 0 || !!secret}
          className="self-start rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Create access token"}
        </button>
      </form>
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Issued tokens</h3>
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
        {tokens === null ? (
          <p role="status" className="mt-3 text-sm text-ink-muted">
            {error
              ? "Tokens could not be loaded. Refresh to try again."
              : "Loading tokens…"}
          </p>
        ) : tokens.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            No tokens issued. Create one when you connect an external agent.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {tokens.map((token) => (
              <li key={token.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">{token.label}</h4>
                    <p className="mt-1 text-xs text-ink-muted">
                      {token.revokedAt
                        ? `Revoked ${displayDate(token.revokedAt)}`
                        : `${new Date(token.expiresAt).getTime() <= now ? "Expired" : "Expires"} ${displayDate(token.expiresAt)}`}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {token.lastUsedAt
                        ? `Last used ${displayDate(token.lastUsedAt)}`
                        : "Not used yet"}
                    </p>
                  </div>
                  {!token.revokedAt && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => revoke(token.id)}
                      className="self-start rounded-lg border border-danger/30 px-3 py-2 text-sm font-semibold text-danger"
                    >
                      Revoke token
                    </button>
                  )}
                </div>
                <ul
                  className="mt-3 flex flex-wrap gap-2"
                  aria-label="Token permissions"
                >
                  {token.scopes.map((scope) => (
                    <li
                      key={scope}
                      className="rounded-lg bg-midnight px-2 py-1 text-xs"
                    >
                      {SCOPES.find((item) => item.value === scope)?.label ??
                        scope}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
