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

The agent-control and review components now use readable JSX and responsive card padding. Held balance values stack beneath their labels on narrow screens, and proposed-action detail fields split into two columns only when there is space. Selecting direct portfolio updates shows a specific explanation beside the permission choices; copy success is announced to assistive technology. Failed balance-review requests explain why review controls stay disabled until a refresh confirms server state.

The assistant uses the available viewport height, a wider reading surface, and an explicit close control that restores focus to its launcher. Starter questions appear before the first user message; conversation space is preserved after a question is sent. The input can shrink without pushing Send outside the panel.

Superdesign source-based agent-control draft: https://p.superdesign.dev/draft/6c6e7d2d-5d23-4a5f-bd49-61a92581c9b0 . This is illustrative design context, not a live account or screenshot-verified authenticated page. Canvas: https://superdesign.dev/teams/daa6c1df-346f-4dc3-81dd-fb4f462aff90/projects/72097302-039b-4f67-81aa-bfda96527ec4 .
