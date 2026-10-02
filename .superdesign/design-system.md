# PointUp interface direction

PointUp is a loyalty travel portfolio: the interface helps a traveler know what they have and plan where to use it. The visual direction borrows from a travel document, with one purposeful ticket illustration on the landing page and quiet, structured account tools on the dashboard.

Palette: cloud #F3F7FB, paper #FFFFFF, sky #DFEBF8, route blue #215BCC, navy ink #152B46, ticket yellow #F7DF93. Positive and error colors remain distinct and carry text labels.

Typography: Avenir Next / Trebuchet MS for headings and Segoe UI / system sans for reading and controls. System fallbacks keep builds and rendering independent of remote font services. Left aligned copy, restrained line lengths, tabular balance numbers.

Layout plan:

```text
Landing:   message + sign-up       illustrative travel ticket
           supported programs
           balance overview | trip goals | redemption options
           introduction     | three actual setup steps
Dashboard: greeting + exports
           section navigation
           portfolio summary
           search / type / tags
           linked programs
           expiry / value / trip goals / activity
           portfolio sharing / add / import
```

The initial centered headline and generic sparkline proposal was revised to a travel ticket: the ticket makes the relationship between rewards and travel explicit without implying real bookings or live sample balances. Illustrative data is labeled. Product copy refers to implemented web behavior and avoids promising automatic integrations, mobile apps, or vault connections that the UI does not establish.

Accessibility: skip link, named navigation, keyboard focus, responsive wrapping, reduced motion, pressed tag filters, program search and clear filters, labeled assistant input, Escape-to-close and focus restoration, live conversation/status feedback, semantic goal progress. Core balance, history, pin, sync, export, import, share and goal actions remain connected to existing application behavior.

Account settings exposes ChatGPT identity linking only when the configured API reports it available. The page requires a PointUp session, uses the existing OAuth start endpoint, and clearly distinguishes identity linking from subscription benefits or loyalty-account actions.

Agent access uses separate sections for scoped tokens, per-account time-limited capture consent, held observations, and proposed assistant actions. Token secrets exist only in component memory after minting and are never included in lists. The capture form states that valid observations can update history automatically, while held observations require acceptance. Assistant reviews show immutable exact values and send only the persisted action ID to browser-authenticated approval routes. Unknown, expired, failed, or executing actions cannot be approved again. A failed review request blocks another attempt until canonical server state is refreshed. Proposal copy does not promise that every assistant runtime can prepare changes.

Target: standalone settings agent controls, with no site header/footer or logo position. Preserve exact control labels and implemented permissions. Cards are paper white on cloud, blue buttons, navy headings. 24px desktop card padding; 16px on phones. Controls target at least 44px height. Definition lists stack on narrow phones, balance figures use tabular numerals. Quiet yellow marks held balances. Accessible native HTML and visible keyboard focus, reduced motion. No invented balances, bookings, automatic providers, subscription benefits or runtime features.
