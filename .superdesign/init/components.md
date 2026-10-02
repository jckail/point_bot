# Shared components

Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4 (CSS-first @theme). Custom components; no shadcn, Radix, MUI or other UI kit. Clerk supplies authentication widgets.

## Button
Pill button; primary, secondary, ghost, danger variants; sm/md/lg sizes. Props: ButtonProps, variant, size, className.

Source: `apps/web/src/components/ui/button.tsx`

```tsx
const VARIANTS = {
  primary:
    "bg-brand text-white hover:bg-brand-strong",
  secondary:
    "border border-brand/40 bg-brand/10 text-brand-soft hover:bg-brand/20",
  ghost: "border border-line text-ink-muted hover:border-ink-faint hover:text-ink",
  danger:
    "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
} as const;

const SIZES = {
  sm: "px-4 py-1.5 text-sm",
  md: "px-6 py-2.5",
  lg: "px-8 py-3",
} as const;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`cursor-pointer disabled:cursor-wait disabled:opacity-50 rounded-xl font-semibold transition ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    />
  );
}
```

## FormFeedback / SubmitButton
Inline success/error status and pending-aware submit button. Props: result, successMessage; pendingLabel and ButtonProps.

Source: `apps/web/src/components/form-feedback.tsx`

```tsx
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
```

## ProviderBadge
Five provider-kind badges with actual SVG icons. Props: kind.

Source: `apps/web/src/components/provider-badge.tsx`

```tsx
import {
  PROVIDER_KIND_LABELS,
  type ProviderKind,
} from "@pointup/core/providers";

function PlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M10.5 13.5 4 11l1.5-1.5 5.5 1 4.5-4.5c.6-.6 1.6-.6 2.2 0 .6.6.6 1.6 0 2.2L13 12.5l1 5.5L12.5 19.5 10 13.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20M15 9h3.5A1.5 1.5 0 0 1 20 10.5V20M3 20h19M8 8h2M8 12h2M8 16h2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <rect
        x="3"
        y="6"
        width="18"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M3 10h18M6.5 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TrainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <rect
        x="6"
        y="4"
        width="12"
        height="12"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8.5 16 6 20M15.5 16l2.5 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M5.5 8h13l-1 12h-11l-1-12ZM8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const KIND_ICONS: Record<ProviderKind, () => React.ReactNode> = {
  airline: PlaneIcon,
  hotel: BuildingIcon,
  credit_card: CardIcon,
  rail: TrainIcon,
  shopping: BagIcon,
};

export function ProviderBadge({ kind }: { kind: ProviderKind }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-midnight px-2.5 py-1 text-xs font-medium text-ink-muted">
      <Icon />
      {PROVIDER_KIND_LABELS[kind]}
    </span>
  );
}
```

## Sparkline
Responsive SVG history chart with gradient line/area. Props: values, width, height.

Source: `apps/web/src/components/sparkline.tsx`

```tsx
/**
 * Dependency-free SVG sparkline. `values` are ordered oldest → newest.
 */
export function Sparkline({
  values,
  width = 480,
  height = 120,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 8;

  const points = values.map((value, index) => {
    const x =
      padding + (index / (values.length - 1)) * (width - padding * 2);
    const y =
      height - padding - ((value - min) / range) * (height - padding * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const lastPoint = points[points.length - 1]!;
  const area = `${padding},${height - padding} ${line} ${lastPoint[0]},${height - padding}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="Balance history chart"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C5CFF" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7C5CFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="spark-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#FFB547" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline
        points={line}
        fill="none"
        stroke="url(#spark-line)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="4" fill="#FFB547" />
    </svg>
  );
}
```

## StatCard
Metric surface with label, value, optional hint.

Source: `apps/web/src/components/stat-card.tsx`

```tsx
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="stat-cell flex flex-col gap-2">
      <span className="text-sm font-medium text-ink-muted">
        {label}
      </span>
      <span className="font-display text-3xl font-bold text-ink">{value}</span>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}
```

## BalanceTrendChips
Positive/negative previous, 30d and 90d balance deltas. Props: trend.

Source: `apps/web/src/components/balance-trend.tsx`

```tsx
import type { BalanceTrend } from "@pointup/core";

import { formatPoints } from "@/lib/format";

function DeltaChip({
  label,
  points,
}: {
  label: string;
  points: number;
}) {
  const positive = points > 0;
  const negative = points < 0;
  const tone = positive
    ? "text-positive"
    : negative
      ? "text-danger"
      : "text-ink-faint";
  const sign = positive ? "+" : "";

  return (
    <span className={`text-xs font-medium ${tone}`}>
      {label} {sign}
      {formatPoints(points)}
    </span>
  );
}

/** Compact trend chips for account cards and the detail page. */
export function BalanceTrendChips({ trend }: { trend: BalanceTrend }) {
  const chips: { label: string; points: number }[] = [];
  if (trend.sincePrevious) {
    chips.push({ label: "vs last", points: trend.sincePrevious.points });
  }
  if (trend.since30Days) {
    chips.push({ label: "30d", points: trend.since30Days.points });
  }
  if (trend.since90Days) {
    chips.push({ label: "90d", points: trend.since90Days.points });
  }
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {chips.map((chip) => (
        <DeltaChip key={chip.label} label={chip.label} points={chip.points} />
      ))}
    </div>
  );
}
```

## Logo / LogoMark
PointUp wordmark and gradient rising-points SVG. Props: size.

Source: `apps/web/src/components/logo.tsx`

```tsx
const gradientStops = (
  <>
    <stop offset="0" stopColor="#215BCC" />
    <stop offset="0.55" stopColor="#4684DE" />
    <stop offset="1" stopColor="#215BCC" />
  </>
);

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden
      className="shrink-0"
    >
      <defs>
        <linearGradient
          id="pu-mark"
          gradientUnits="userSpaceOnUse"
          x1="60"
          y1="200"
          x2="200"
          y2="56"
        >
          {gradientStops}
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="60" className="fill-surface-raised" />
      <circle cx="76" cy="182" r="13" fill="url(#pu-mark)" />
      <circle cx="110" cy="148" r="16" fill="url(#pu-mark)" />
      <circle cx="144" cy="114" r="19" fill="url(#pu-mark)" />
      <path d="M140 60 h58 v58 z" fill="url(#pu-mark)" />
    </svg>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span
        className="font-display font-bold tracking-tight text-ink"
        style={{ fontSize: size * 0.7 }}
      >
        Point<span className="text-brand">Up</span>
      </span>
    </span>
  );
}
```


## agent-token-controls

Source: `apps/web/src/components/agent-token-controls.tsx`

```tsx
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
```


## capture-consent-controls

Source: `apps/web/src/components/capture-consent-controls.tsx`

```tsx
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
```


## balance-observation-reviews

Source: `apps/web/src/components/balance-observation-reviews.tsx`

```tsx
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
```


## reviewed-assistant-actions

Source: `apps/web/src/components/reviewed-assistant-actions.tsx`

```tsx
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
  const [actions, setActions] = useState<ReviewedAction[] | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [blockedId, setBlockedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
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
        }
      })
      .catch((err) => {
        if (active && requestGate.current.canApplyRead(generation))
          setError(agentError(err));
      });
    return () => {
      active = false;
    };
  }, [version, refreshKey]);
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
      if (result.action.status === "succeeded") router.refresh();
    } catch (err) {
      setBlockedId(action.id);
      setError(agentError(err));
    } finally {
      requestGate.current.finishReview();
      setPendingId(null);
    }
  }
  if (compact && actions?.length === 0 && !error) return null;
  return (
    <section
      id={compact ? undefined : "assistant-actions"}
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
                      <dd className="mt-0.5 break-words font-medium">
                        {detail.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-ink-muted">
                  Review before {displayDate(action.expiresAt)}
                </p>
                <p
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
                      onClick={() => review(action, "approve")}
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
                      onClick={() => review(action, "reject")}
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
```


## assistant-panel

Source: `apps/web/src/components/assistant-panel.tsx`

```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { ReviewedAssistantActions } from "@/components/reviewed-assistant-actions";

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  shortened?: boolean;
};
type ChatError = { message: string; requestId?: string };

const MESSAGE_LIMIT = 4_000;
const TRANSCRIPT_LIMIT = 40;
const REQUEST_TIMEOUT_MS = 125_000;
const GREETING: ChatTurn = {
  role: "assistant",
  content:
    "Ask about your linked balances, expiring points, trip goals, and redemption estimates. I can help you compare options. Proposed account changes need your approval in PointUp; I cannot book travel or transfer points.",
};

const SUGGESTIONS = [
  "What's my best transfer right now?",
  "Am I at risk of points expiring?",
  "How do I finish my trip goal faster?",
  "Where's the best bang for my buck?",
];

export function AssistantPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([GREETING]);
  const [error, setError] = useState<ChatError | null>(null);
  const [actionsVersion, setActionsVersion] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [turns, pending]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function closeAssistant() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  function clearChat() {
    if (requestRef.current) return;
    setTurns([GREETING]);
    setInput("");
    setError(null);
    inputRef.current?.focus();
  }

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || pending || requestRef.current) return;
    if (trimmed.length > MESSAGE_LIMIT) {
      setError({ message: "Keep your message to 4,000 characters or fewer." });
      return;
    }

    const lastTurn = turns.at(-1);
    const retrying =
      error !== null &&
      lastTurn?.role === "user" &&
      lastTurn.content === trimmed;
    const history = (retrying ? turns.slice(0, -1) : turns)
      .slice(-8)
      .map(({ role, content }) => ({
        role,
        content: content.slice(0, MESSAGE_LIMIT),
      }));
    const controller = new AbortController();
    requestRef.current = controller;
    if (!retrying)
      setTurns((prev) =>
        [...prev, { role: "user", content: trimmed } as ChatTurn].slice(
          -TRANSCRIPT_LIMIT,
        ),
      );
    setInput("");
    setError(null);

    startTransition(async () => {
      let requestId: string | undefined;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("/api/v1/assistant/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PointUp-Surface": "web",
          },
          signal: controller.signal,
          body: JSON.stringify({ message: trimmed, history }),
        });
        requestId = response.headers.get("X-PointUp-Request-Id") ?? undefined;
        const payload = (await response.json().catch(() => null)) as {
          reply?: string;
          error?: { message?: string };
        } | null;
        if (!response.ok) {
          throw new Error(
            payload?.error?.message ??
              "The assistant could not answer. Try again.",
          );
        }
        if (typeof payload?.reply !== "string" || !payload.reply.trim())
          throw new Error("The assistant returned an empty answer. Try again.");
        const reply = payload.reply;
        setTurns((prev) =>
          [
            ...prev,
            {
              role: "assistant",
              content: reply.slice(0, MESSAGE_LIMIT),
              shortened: reply.length > MESSAGE_LIMIT,
            } as ChatTurn,
          ].slice(-TRANSCRIPT_LIMIT),
        );
      } catch (err) {
        setInput(trimmed);
        setError({
          message: controller.signal.aborted
            ? timedOut
              ? "The assistant took too long to respond. Your message is ready to try again."
              : "Request stopped. Your message is ready to send again."
            : err instanceof Error && err.message !== "Failed to fetch"
              ? err.message
              : "The assistant could not be reached. Check your connection and try again.",
          requestId,
        });
      } finally {
        setActionsVersion((value) => value + 1);
        window.clearTimeout(timeout);
        if (requestRef.current === controller) requestRef.current = null;
      }
    });
  }

  return (
    <>
      <button
        ref={toggleRef}
        aria-expanded={open}
        aria-controls="pointup-assistant"
        type="button"
        onClick={() => (open ? closeAssistant() : setOpen(true))}
        className="fixed bottom-5 right-5 z-50 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/40 transition hover:bg-brand-strong"
      >
        {open ? "Close assistant" : "Ask PointUp"}
      </button>

      {open && (
        <section
          id="pointup-assistant"
          aria-label="PointUp Assistant"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeAssistant();
            }
          }}
          className="fixed bottom-20 right-5 z-50 flex h-[min(38rem,calc(100dvh-8rem))] w-[min(28rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-midnight shadow-2xl"
        >
          <header className="shrink-0 border-b border-line bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-ink">
                PointUp Assistant
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={clearChat}
                  disabled={pending}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-brand disabled:opacity-50"
                >
                  Clear chat
                </button>
                <button
                  type="button"
                  onClick={closeAssistant}
                  aria-label="Close PointUp Assistant"
                  className="rounded-lg px-3 py-2 text-lg leading-none text-ink-muted"
                >
                  ×
                </button>
              </div>
            </div>
            <p className="text-xs text-ink-faint">
              Portfolio advice and changes for your review
            </p>
            <a
              href="/dashboard/settings"
              className="mt-1 inline-block text-xs text-brand underline"
            >
              Manage agent access
            </a>
          </header>

          <div
            ref={messagesRef}
            role="log"
            aria-live="polite"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3"
          >
            {turns.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  turn.role === "user"
                    ? "ml-6 bg-brand/20 text-ink"
                    : "mr-4 bg-line/40 text-ink-muted"
                }`}
              >
                {turn.content}
                {turn.shortened && (
                  <p className="mt-2 text-xs font-medium">
                    Answer shortened. Ask a more specific question for details.
                  </p>
                )}
              </div>
            ))}
            <ReviewedAssistantActions compact refreshKey={actionsVersion} />
            {pending && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-ink-faint">Thinking…</p>
                <button
                  type="button"
                  onClick={() => requestRef.current?.abort()}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted"
                >
                  Stop request
                </button>
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-danger/20 p-3 text-xs text-danger"
              >
                <p>{error.message}</p>
                {error.requestId && (
                  <p className="mt-2 break-all text-ink-muted">
                    Support reference: {error.requestId}
                  </p>
                )}
              </div>
            )}
          </div>

          {turns.length === 1 && !error && (
            <div className="flex shrink-0 flex-wrap gap-2 border-t border-line p-3">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={pending}
                  onClick={() => send(suggestion)}
                  className="min-h-10 rounded-xl border border-line px-3 py-2 text-xs text-ink-muted transition hover:border-brand hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex shrink-0 gap-2 border-t border-line bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <input
              ref={inputRef}
              aria-label="Message to PointUp Assistant"
              maxLength={MESSAGE_LIMIT}
              disabled={pending}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about your points…"
              className="min-w-0 flex-1 rounded-xl border border-line bg-midnight px-3 py-2 text-sm text-ink outline-none focus:border-brand"
            />
            <button
              type="submit"
              disabled={pending || input.trim().length === 0}
              className="rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      )}
    </>
  );
}
```
