# PointUp brand kit

The brand story: **points climbing**. The logomark is a run of three points ascending a diagonal, resolved by an arrowhead — progress you can see at a glance, which is exactly what the product does for loyalty balances.

## Assets

All master assets live in `apps/web/public/brand/`:

| Asset | File | Use |
| --- | --- | --- |
| Logomark (color) | `brand/logomark.svg` | App tiles, avatars, social profile images |
| Logomark (mono) | `brand/logomark-mono.svg` | Favicons, single-color contexts; inherits `currentColor` |
| Horizontal lockup | `brand/logo-horizontal.svg` | Headers, docs, presentations¹ |
| Favicon | `apps/web/src/app/icon.svg` | Served automatically by Next.js |
| Social card | `apps/web/src/app/opengraph-image.tsx` | OG/Twitter image, rendered from tokens at request time |
| React components | `apps/web/src/components/logo.tsx` | `<Logo />` and `<LogoMark />` inside the app |

¹ The lockup wordmark uses live text (Sora). Convert to outlines before print use.

### Clear space & minimum size

Keep clear space equal to the diameter of the largest point around the logomark. Don't render the mark below 16 px; use the mono variant below 24 px.

## Color

Defined once as Tailwind v4 tokens in `apps/web/src/styles/globals.css` (`@theme`).

| Token | Hex | Role |
| --- | --- | --- |
| `midnight` | `#0B1020` | App background, logomark tile |
| `surface` | `#121A30` | Cards, panels |
| `surface-raised` | `#1A2342` | Elevated elements |
| `brand` | `#7C5CFF` | Primary actions, links, brand accents ("Ascent Violet") |
| `brand-strong` | `#5B3DF5` | Hover/pressed primary |
| `brand-soft` | `#A78BFA` | Secondary brand text, outlines |
| `gold` | `#FFB547` | The "milestone" accent — achievement moments, gradient endpoint |
| `ink` | `#F4F6FF` | Primary text |
| `ink-muted` | `#9AA5CB` | Secondary text |
| `ink-faint` | `#5F6A8F` | Tertiary text, captions |
| `positive` | `#34D399` | Balance increases, success |
| `danger` | `#FB7185` | Errors, destructive actions |

**The ascent gradient** — violet → soft violet → gold, always running bottom-left to top-right (the climbing direction): `linear-gradient(100deg, #A78BFA, #7C5CFF 45%, #FFB547)`. Available as the `text-gradient-brand` utility. Use it sparingly: one gradient moment per screen.

## Typography

Both typefaces are open source (OFL) and loaded via `next/font`:

| Font | Token | Role |
| --- | --- | --- |
| [Sora](https://fonts.google.com/specimen/Sora) | `font-display` | Headlines, stat values, the wordmark |
| [Inter](https://rsms.me/inter/) | `font-sans` | Body copy, UI controls |

Wordmark: Sora Bold, tight tracking, "Point" in ink + "Up" in brand violet.

## Voice

- **Clear over clever.** Say what the number is and when it was last true.
- **Momentum.** Prefer active, upward language: climb, track, sync — never jargon like "leverage".
- **Trustworthy on security.** Be explicit: "PointUp never stores provider passwords."

## Component conventions

- Cards use the `card-surface` utility (surface color, 1px `line` border, `rounded-2xl`).
- Primary buttons: `bg-brand` pill with `shadow-brand/30`; secondary: `border-line` pill.
- Dark UI is the default and only theme for now; check contrast against `midnight` (AA minimum).
