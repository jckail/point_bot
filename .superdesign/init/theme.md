# Current PointUp theme

Authoritative CSS-first Tailwind v4 tokens and shared styles. System fonts require no remote asset.

```css
@import "tailwindcss";

@theme {
  --color-midnight: #f3f7fb;
  --color-surface: #ffffff;
  --color-surface-raised: #e5eef9;
  --color-line: #d4deea;
  --color-brand: #215bcc;
  --color-brand-strong: #17449e;
  --color-brand-soft: #215bcc;
  --color-gold: #986c00;
  --color-gold-soft: #f7df93;
  --color-ink: #152b46;
  --color-ink-muted: #4b6077;
  --color-ink-faint: #596d82;
  --color-positive: #147450;
  --color-danger: #b82f46;
  --font-display: "Avenir Next", "Trebuchet MS", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
}
@layer base {
  body { background: var(--color-midnight); color: var(--color-ink); }
  ::selection { background: #f7df93; color: #152b46; }
  :focus-visible { outline: 3px solid var(--color-brand); outline-offset: 4px; }
  button, a, input, select, textarea { -webkit-tap-highlight-color: transparent; }
  button:not(:disabled), select { cursor: pointer; }
  button:disabled { cursor: wait; opacity: .55; }
  input, select, textarea { min-width: 0; }
  input:focus-visible, select:focus-visible, textarea:focus-visible { outline-offset: 2px; }
  [id] { scroll-margin-top: 7rem; }
}
@utility card-surface {
  border-radius: 1rem;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
}
@utility text-gradient-brand { color: var(--color-brand); }
.skip-link { position: fixed; top: -5rem; left: 1rem; z-index: 100; background: white; padding: .75rem 1rem; border-radius: .5rem; }
.skip-link:focus { top: .75rem; }
.site-header { background: rgb(255 255 255 / .94); }
.landing-hero { background: #dfebf8; overflow: hidden; }
.hero-layout { display: grid; grid-template-columns: 1.05fr 1fr; gap: 4rem; align-items: center; padding-block: 5.5rem; }
.hero-title { font-size: clamp(3rem, 5.6vw, 5rem); line-height: 1.06; letter-spacing: -.055em; font-weight: 700; max-width: 10ch; }
.hero-description { max-width: 40ch; font-size: 1.1rem; line-height: 1.7; }
.hero-visual { position: relative; padding: 2rem 0 0; }
.route-map { width: 100%; height: 180px; display: block; }
.travel-ticket { position: relative; background: white; border: 1px solid #bdcfe4; border-radius: 1.25rem; box-shadow: 0 20px 45px rgb(38 73 114 / .12); overflow: hidden; }
.ticket-top { display:flex; justify-content: space-between; align-items:center; gap: 1rem; padding: 1rem 1.5rem; background: #f7df93; color: #44340d; }
.ticket-body { padding: 1.5rem; }
.ticket-route { display: flex; gap: 1rem; align-items:center; justify-content:space-between; margin: 1rem 0; }
.ticket-route hr { flex:1; border:0; border-top: 2px dashed #bdcfe4; }
.ticket-program { display:flex; justify-content:space-between; gap:1rem; padding: .8rem 0; border-top:1px solid #d4deea; }
.ticket-program strong { font-variant-numeric: tabular-nums; }
.ticket-caption { border-top: 1px dashed #bdcfe4; padding: .8rem 1.5rem; background: #f8fbfe; font-size:.75rem; color: #596d82; }
.program-strip { background:white; border-bottom:1px solid #d4deea; padding:1.8rem 0; }
.program-list { display:flex; flex-wrap:wrap; gap:.65rem; margin-top:1rem; }
.program-pill { padding:.45rem .8rem; background:#f3f7fb; border-radius:.4rem; font-size:.85rem; }
.feature-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:2.5rem; }
.feature-symbol { width:2.8rem; height:2.8rem; background:#e5eef9; color:#215bcc; display:grid; place-items:center; border-radius:.75rem; margin-bottom:1.2rem; }
.feature-symbol svg { width:24px; height:24px; }
.start-panel { display:grid; grid-template-columns:1fr 1.5fr; gap:3rem; background:#152b46; color:white; padding:3rem; border-radius:1.5rem; }
.start-steps { display:flex; flex-direction:column; gap:1.5rem; }
.start-step { display:flex; gap:1rem; }
.step-number { display:grid; place-items:center; width:2rem; height:2rem; flex-shrink:0; border:1px solid #8ca4c2; border-radius:50%; color:#f7df93; }
.dashboard-nav { display:flex; gap:.3rem; overflow-x:auto; border-bottom:1px solid var(--color-line); padding-bottom:.7rem; }
.dashboard-nav a { white-space:nowrap; padding:.6rem .9rem; color:var(--color-ink-muted); font-size:.9rem; font-weight:600; border-radius:.5rem; }
.dashboard-nav a:hover { background:var(--color-surface-raised); color:var(--color-brand); }
.dashboard-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); background:white; border:1px solid var(--color-line); border-radius:1rem; overflow:hidden; }
.stat-cell { padding:1.4rem; border-right:1px solid var(--color-line); }
.stat-cell:first-child { background:#e5eef9; }
.dashboard-section { display:flex; flex-direction:column; gap:1.3rem; }
.account-card { border-top:4px solid #215bcc; }
.account-tools { display:flex; flex-wrap:wrap; justify-content:space-between; gap:1rem; align-items:center; }
.account-search { width:min(100%,22rem); display:flex; flex-direction:column; gap:.35rem; font-size:.85rem; }
@media (max-width: 850px) {
  .hero-layout { grid-template-columns:1fr; gap:2rem; padding-block:3rem; }
  .hero-title { max-width:13ch; }
  .hero-visual { max-width:34rem; width:100%; margin:auto; }
  .feature-grid { grid-template-columns:1fr; gap:2rem; }
  .start-panel { grid-template-columns:1fr; padding:2rem; gap:2rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation:none !important; transition:none !important; scroll-behavior:auto !important; }
}

```
