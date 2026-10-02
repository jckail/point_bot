# PointUp brand kit

PointUp turns scattered loyalty balances into a travel portfolio. The ascending three-point mark and arrowhead remain the identity: the same geometry connects the original brand to the lighter travel interface.

## Assets

Master SVGs live in `apps/web/public/brand/`. The color mark and horizontal lockup use travel blue; the mono mark inherits `currentColor`. Next.js serves `apps/web/src/app/icon.svg` as the favicon and renders the social card from `apps/web/src/app/opengraph-image.tsx`. In-app `Logo` and `LogoMark` live in `apps/web/src/components/logo.tsx`.

Keep the palette synchronized across these assets, the global theme, and the dynamically loaded Clerk appearance. Preserve the ascending geometry and PointUp spelling. The horizontal lockup contains live Sora text; use an outlined export for print. Keep clear space equal to the largest point's diameter, a minimum mark size of 16 px, and prefer the mono mark below 24 px.

## Color

Tailwind v4 tokens in `apps/web/src/styles/globals.css` are the web source of truth. Token names remain compatible with existing application components.

| Token | Hex | Role |
| --- | --- | --- |
| `midnight` | `#F3F7FB` | Page background; legacy token name retained |
| `surface` | `#FFFFFF` | Cards and panels |
| `surface-raised` | `#E5EEF9` | Selected sections and mark tile |
| `line` | `#D4DEEA` | Borders and separators |
| `brand` / `brand-soft` | `#215BCC` | Primary actions, links, focus and mark |
| `brand-strong` | `#17449E` | Primary hover/pressed state |
| `gold` | `#8A6200` | Value and milestone text |
| `gold-soft` | `#F7DF93` | Travel-ticket accent and selection |
| `ink` | `#152B46` | Primary text |
| `ink-muted` | `#4B6077` | Supporting text |
| `ink-faint` | `#596D82` | Captions and metadata |
| `positive` | `#147450` | Success and balance increases |
| `danger` | `#B82F46` | Errors and destructive actions |

The mark blends blue `#215BCC` through `#4684DE` and back to blue, ascending from bottom-left to top-right. `text-gradient-brand` remains a compatibility utility and now renders solid brand blue. Avoid decorative gradient text. Primary actions use white text on blue; `text-midnight` is a light background color and is unsuitable as their text color.

Source-token contrast on white is approximately 5.34:1 for faint text and 6.12:1 for primary blue. Check rendered background combinations, opacity, chart colors, focus and feedback states before shipping. A token-level calculation is not a browser accessibility check.

## Typography and layout

Sora carries headings, stats and the wordmark; Inter carries body copy and controls. Both are self-hosted variable fonts loaded with `next/font/local`, retaining offline production builds and avoiding external font requests. Do not replace them with the native reference's platform-dependent Avenir Next.

The landing page's distinctive element is the illustrative travel ticket and route map. Keep surrounding features quiet, left-aligned and easy to scan. Sample balances must be labeled as examples and must not imply equal value across loyalty currencies. Portfolio navigation, readable totals and program discovery take precedence over decoration.

Cards use the `card-surface` utility with a white surface, 1 px border and 1 rem radius. Primary actions use 0.75 rem rounded corners. The header retains Dashboard, Agents and Settings in both auth modes; production sign-in remains conditionally loaded through Clerk. The visual system includes a working skip target, visible focus outlines, responsive section layouts and reduced-motion support.

## Voice and capability claims

Write for someone organizing a trip: name their programs, balances, expirations and next action. Explain value estimates and ask users to confirm provider award availability before transferring. Linking a membership does not itself promise automatic sync. Manual balance entry, supported capture/sync methods, agent consent and human review are distinct flows.

Describe the Chrome extension as an available supported capture surface, not a future API demo. Ask PointUp helps with authorized portfolio data and proposes changes for review; it does not silently approve them. Keep implementation details and infrastructure names out of product onboarding. Do not imply an unsupported vault connection or provider integration exists.
