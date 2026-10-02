import { PROVIDER_CATALOG } from "@pointup/core";
import Link from "next/link";

import { ProviderBadge } from "@/components/provider-badge";
import { isDevAuth } from "@/server/auth";

function TravelPreview() {
  return (
    <div className="hero-visual">
      <svg className="route-map" viewBox="0 0 500 150" aria-hidden="true" focusable="false">
        <path d="M15 120 Q150 150 215 60 T480 30" fill="none" stroke="#91accd" strokeWidth="2" strokeDasharray="6 7" />
        <circle cx="15" cy="120" r="6" fill="#215bcc" />
        <circle cx="480" cy="30" r="6" fill="#215bcc" />
        <path d="M227 48 l32 -13 -11 21 15 10 -8 4 -16 -8 -10 13 -6 -2 6 -19 -12 -5z" fill="#215bcc" />
      </svg>
      <div className="travel-ticket">
        <div className="ticket-top"><strong>PointUp travel portfolio</strong><span className="text-xs font-medium">Illustrative preview</span></div>
        <div className="ticket-body">
          <div className="ticket-route">
            <div className="text-sm text-ink-muted">From<br /><strong className="font-display text-xl text-ink">Points</strong></div>
            <span className="ticket-route-rule" aria-hidden="true" />
            <div className="text-right text-sm text-ink-muted">To<br /><strong className="font-display text-xl text-ink">Possibilities</strong></div>
          </div>
          <dl>
            <div className="ticket-program"><dt>Airline miles</dt><dd><strong>48,320</strong></dd></div>
            <div className="ticket-program"><dt>Hotel points</dt><dd><strong>25,800</strong></dd></div>
            <div className="ticket-program"><dt className="font-semibold">Total points tracked</dt><dd><strong className="text-brand">74,120</strong></dd></div>
          </dl>
        </div>
        <p className="ticket-caption">Example balances. Your portfolio uses the programs you link. Points from different programs have different values.</p>
      </div>
    </div>
  );
}

const features = [
  { title: "Know what you have", body: "Bring your loyalty balances together. Record updates, check your history, and keep memberships organized.", path: "M4 5h16v14H4z M4 10h16 M10 10v9" },
  { title: "Give your points a destination", body: "Set a trip goal, choose the programs that count toward it, and see how many points you still need.", path: "M12 21s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z M9 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0" },
  { title: "Make the next move clearer", body: "Compare estimated redemption value and transfer options. Ask PointUp about your plans, with proposed changes ready for your review.", path: "M4 17l6-6 4 3 6-9 M14 5h6v6" },
];

// A concise cross-section of the real catalog keeps onboarding easy to scan.
const previewProgramIds = new Set([
  "united", "delta", "american", "marriott", "hyatt", "hilton",
  "chase-ultimate-rewards", "amex-membership-rewards", "amtrak",
  "hertz-gold-plus-rewards", "royal-caribbean-crown-anchor", "grab-rewards",
  "starbucks-rewards", "rakuten",
]);
const previewPrograms = PROVIDER_CATALOG.filter(provider => previewProgramIds.has(provider.id));

export default async function Home() {
  const ClerkHeroCta = isDevAuth() ? null : (await import("@/components/clerk-hero-cta")).ClerkHeroCta;
  return (
    <main>
      <section className="landing-hero">
        <div className="hero-layout mx-auto max-w-6xl px-5 sm:px-6">
          <div>
            <h1 className="font-display hero-title">Your points have places to go.</h1>
            <p className="hero-description mt-6 text-ink-muted">A clear home for your loyalty programs. Know your balances, keep an eye on expirations, and turn a someday trip into a plan.</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {ClerkHeroCta ? <ClerkHeroCta /> : <Link href="/dashboard" className="hero-cta">Open the dev dashboard</Link>}
              <a href="#how-it-works" className="rounded-lg px-2 py-3 font-semibold text-ink hover:text-brand">See how it works</a>
            </div>
            <p className="mt-5 text-sm text-ink-muted">Start with your membership numbers. Add balances as you go.</p>
          </div>
          <TravelPreview />
        </div>
      </section>
      <section className="program-strip" aria-label="Loyalty program catalog">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <p className="text-sm font-medium text-ink-muted">A home for the programs you already use</p>
          <div className="program-list">{previewPrograms.map(provider => <span className="program-pill" key={provider.id}>{provider.displayName}<ProviderBadge kind={provider.kind} /></span>)}</div>
          <p className="mt-3 text-xs leading-6 text-ink-faint">Examples from a catalog of {PROVIDER_CATALOG.length} programs. Browse the full catalog when linking a membership. Capture and automatic sync availability vary by program.</p>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-20" aria-labelledby="features-title">
        <h2 id="features-title" className="font-display mb-10 max-w-xl text-3xl font-bold tracking-tight">Less keeping track.<br />More looking ahead.</h2>
        <div className="feature-grid">{features.map(feature => (
          <article key={feature.title}>
            <div className="feature-symbol"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={feature.path} /></svg></div>
            <h3 className="font-display text-xl font-semibold">{feature.title}</h3>
            <p className="mt-3 max-w-prose text-sm leading-7 text-ink-muted">{feature.body}</p>
          </article>
        ))}</div>
      </section>
      <section id="how-it-works" className="mx-auto max-w-6xl px-5 pb-20 sm:px-6" aria-labelledby="start-title">
        <div className="start-panel">
          <div><h2 id="start-title" className="font-display text-3xl font-bold tracking-tight">A little organization.<br />A lot to look forward to.</h2><p className="mt-4 text-sm leading-7 text-slate-300">Keep the details together, from your first balance to your next trip goal.</p></div>
          <ol className="start-steps">{[
            ["Create your portfolio", "Sign in to keep your programs and balance history together."],
            ["Add your memberships", "Choose a program and enter your membership number. Record a balance manually or use supported capture and sync methods."],
            ["Plan your next trip", "Set a points target and compare options. Value estimates are a guide; confirm award availability with the provider."],
          ].map(([title, body], index) => <li className="start-step" key={title}><span className="step-number" aria-hidden="true">{index + 1}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-300">{body}</p></div></li>)}</ol>
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-7 text-ink-muted">Use the Chrome extension to capture supported program balances from your signed-in provider pages. Agent capture needs your consent. Ask PointUp on your dashboard; you review proposed changes before they take effect.</p>
      </section>
    </main>
  );
}
