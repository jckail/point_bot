import { Show, SignUpButton } from "@clerk/nextjs";
import { PROVIDER_CATALOG } from "@pointup/core";
import Link from "next/link";

import { ProviderBadge } from "@/components/provider-badge";
import { Sparkline } from "@/components/sparkline";

const PREVIEW_BALANCES = [
  38200, 38200, 41450, 41450, 45900, 52300, 52300, 54800, 61250, 61250, 68400,
  74120,
];

function HeroPreview() {
  return (
    <div className="card-surface w-full max-w-2xl p-6 text-left shadow-2xl shadow-brand/10 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            Points tracked
          </p>
          <p className="font-display mt-1 text-4xl font-bold text-ink">
            74,120
          </p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <p className="text-xs text-ink-faint">Airline miles</p>
            <p className="font-display font-semibold text-ink">48,320</p>
          </div>
          <div>
            <p className="text-xs text-ink-faint">Hotel points</p>
            <p className="font-display font-semibold text-ink">25,800</p>
          </div>
        </div>
      </div>
      <div className="mt-6">
        <Sparkline values={PREVIEW_BALANCES} height={100} />
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Twelve syncs of history across four programs - a preview of your
        dashboard.
      </p>
    </div>
  );
}

function FeatureCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-surface p-6">
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{children}</p>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <span className="font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand/40 bg-brand/10 font-bold text-brand-soft">
        {number}
      </span>
      <div>
        <h3 className="font-display font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-sm text-ink-muted">{children}</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(700px 360px at 80% 0%, rgb(124 92 255 / 0.25), transparent), radial-gradient(500px 280px at 10% 100%, rgb(255 181 71 / 0.10), transparent)",
          }}
        />
        <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6 md:py-32">
          <h1 className="font-display max-w-3xl text-5xl font-bold tracking-tight text-ink md:text-7xl">
            All your points. <span className="text-gradient-brand">One clear view.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-muted">
            Airline miles, hotel points, balance history - tracked in one
            place. On the web, on your phone, or right in your browser.
          </p>

          <div className="mt-10 flex items-center gap-4">
            <Show when="signed-out">
              <SignUpButton mode="modal">
                <button className="cursor-pointer rounded-full bg-brand px-8 py-3 font-semibold text-white shadow-xl shadow-brand/30 transition hover:bg-brand-strong">
                  Start tracking free
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link
                href="/dashboard"
                className="rounded-full bg-brand px-8 py-3 font-semibold text-white no-underline shadow-xl shadow-brand/30 transition hover:bg-brand-strong"
              >
                Open your dashboard
              </Link>
            </Show>
            <a
              href="https://github.com/jckail/pointup"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-line px-8 py-3 font-semibold text-ink-muted no-underline transition hover:border-ink-faint hover:text-ink"
            >
              View source
            </a>
          </div>

          <div className="mt-16 flex w-full justify-center">
            <HeroPreview />
          </div>

          {/* Provider strip */}
          <div className="mt-16 flex flex-wrap items-center justify-center gap-3">
            {PROVIDER_CATALOG.map((provider) => (
              <span
                key={provider.id}
                className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink-muted"
              >
                {provider.displayName}
                <ProviderBadge kind={provider.kind} />
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="Every program, one dashboard">
            Link airline and hotel memberships in seconds. Balances sync into
            an append-only history, so you always know where your points went.
          </FeatureCard>
          <FeatureCard title="Your vault, your credentials">
            PointUp never stores provider passwords. Keep them in 1Password,
            Apple Keychain, or Chrome - credentials are used once per sync and
            never persisted.
          </FeatureCard>
          <FeatureCard title="Beyond the browser">
            A versioned API and typed client power every surface: this web
            app today, mobile apps and browser extensions next.
          </FeatureCard>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        <div className="card-surface grid gap-8 p-8 md:grid-cols-3 md:p-10">
          <Step number="1" title="Create your account">
            Sign up with email or a social login - user management is handled
            securely by Clerk.
          </Step>
          <Step number="2" title="Link your programs">
            Add memberships by number. Connect a credential vault when you
            want automated syncs.
          </Step>
          <Step number="3" title="Watch points climb">
            Sync balances on demand and keep a full history across every
            program.
          </Step>
        </div>
      </section>
    </main>
  );
}
