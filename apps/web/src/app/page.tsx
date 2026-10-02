import { Show, SignUpButton } from "@clerk/nextjs";
import { PROVIDER_CATALOG } from "@pointup/core";
import Link from "next/link";

function StartButton() {
  return <>
    <Show when="signed-out"><SignUpButton mode="modal"><button className="rounded-xl bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-strong">Create your portfolio</button></SignUpButton></Show>
    <Show when="signed-in"><Link href="/dashboard" className="rounded-xl bg-brand px-6 py-3 font-semibold text-white">Open your portfolio</Link></Show>
  </>;
}

function TravelPreview() {
  return <div className="hero-visual">
    <svg className="route-map" viewBox="0 0 500 180" aria-hidden="true">
      <path d="M15 135 Q150 160 215 70 T480 40" fill="none" stroke="#91accd" strokeWidth="2" strokeDasharray="6 7" />
      <circle cx="15" cy="135" r="6" fill="#215bcc"/><circle cx="480" cy="40" r="6" fill="#215bcc"/>
      <path d="M227 58 l32 -13 -11 21 15 10 -8 4 -16 -8 -10 13 -6 -2 6 -19 -12 -5z" fill="#215bcc" />
      <text x="27" y="116" fill="#4b6077" fontSize="14">Your everyday rewards</text><text x="336" y="72" fill="#4b6077" fontSize="14">Your next adventure</text>
    </svg>
    <div className="travel-ticket">
      <div className="ticket-top"><strong>PointUp travel portfolio</strong><span className="text-xs">Illustrative preview</span></div>
      <div className="ticket-body">
        <div className="ticket-route"><span className="text-sm text-ink-muted">From<br/><strong className="text-xl text-ink">Points</strong></span><hr/><span className="text-right text-sm text-ink-muted">To<br/><strong className="text-xl text-ink">Possibilities</strong></span></div>
        <div className="ticket-program"><span>Airline miles</span><strong>48,320</strong></div>
        <div className="ticket-program"><span>Hotel points</span><strong>25,800</strong></div>
        <div className="ticket-program"><span className="font-semibold">Total points tracked</span><strong className="text-brand">74,120</strong></div>
      </div>
      <p className="ticket-caption">Example balances. Your dashboard uses the programs you link.</p>
    </div>
  </div>;
}

const features = [
  { title: "Know what you have", body: "Bring airline, hotel, and card balances together. Record updates, check your history, and keep memberships organized.", path: "M4 5h16v14H4z M4 10h16 M10 10v9" },
  { title: "Give your points a destination", body: "Set a trip goal, choose the programs that count toward it, and see how many points you still need.", path: "M12 21s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z M9 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0" },
  { title: "Make the next move clearer", body: "Compare transfer options and curated redemptions using your balances. Keep upcoming expirations in view.", path: "M4 17l6-6 4 3 6-9 M14 5h6v6" },
];

export default function Home() {
  return <main>
    <section className="landing-hero">
      <div className="hero-layout mx-auto max-w-6xl px-5 sm:px-6">
        <div><h1 className="font-display hero-title">Your points have places to go.</h1>
          <p className="hero-description mt-6 text-ink-muted">A clear home for your loyalty programs. Know your balances, keep an eye on expirations, and turn a someday trip into a plan.</p>
          <div className="mt-8 flex flex-wrap items-center gap-4"><StartButton/><a href="#how-it-works" className="px-2 py-3 font-semibold text-ink">See how it works</a></div>
          <p className="mt-5 text-sm text-ink-muted">Start with your membership numbers. Add balances as you go.</p>
        </div><TravelPreview/>
      </div>
    </section>
    <section className="program-strip" aria-label="Supported loyalty programs"><div className="mx-auto max-w-6xl px-5 sm:px-6"><p className="text-sm font-medium text-ink-muted">A home for the programs you already use</p><div className="program-list">{PROVIDER_CATALOG.map(provider=><span className="program-pill" key={provider.id}>{provider.displayName}</span>)}</div></div></section>
    <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-20"><h2 className="font-display mb-10 max-w-xl text-3xl font-bold tracking-tight">Less keeping track.<br/>More looking ahead.</h2><div className="feature-grid">{features.map(feature=><article key={feature.title}><div className="feature-symbol"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={feature.path}/></svg></div><h3 className="font-display text-xl font-semibold">{feature.title}</h3><p className="mt-3 max-w-prose text-sm leading-7 text-ink-muted">{feature.body}</p></article>)}</div></section>
    <section id="how-it-works" className="mx-auto max-w-6xl px-5 pb-20 sm:px-6"><div className="start-panel"><div><h2 className="font-display text-3xl font-bold tracking-tight">A little organization.<br/>A lot to look forward to.</h2><p className="mt-4 text-sm leading-7 text-slate-300">Keep the details together, from your first balance to your next trip goal.</p></div><ol className="start-steps">{[
      ["Create your portfolio", "Sign in to keep your programs and balance history together."],
      ["Add your memberships", "Choose a program and enter your membership number. Record a balance or sync where supported."],
      ["Plan your next trip", "Set a points target and compare options. Value estimates are a guide; confirm award availability with the provider."],
    ].map(([title,body],i)=><li className="start-step" key={title}><span className="step-number">{i+1}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-300">{body}</p></div></li>)}</ol></div></section>
  </main>;
}
