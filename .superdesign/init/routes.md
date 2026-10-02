# Routes

Next.js file-based App Router; every web page uses `apps/web/src/app/layout.tsx`. No separate router config.

| URL | Entry | Content |
| --- | --- | --- |
| `/` | `apps/web/src/app/page.tsx` | Home: Centered hero, CTA, balance preview sparkline, provider strip, three feature cards and three onboarding steps. |
| `/dashboard` | `apps/web/src/app/dashboard/page.tsx` | Dashboard: Authenticated portfolio metrics, account grid/filtering, restore/expiry notices, deals/transfers, trip goals, activity, sharing, link/import forms and assistant. |
| `/dashboard/accounts/[id]` | `apps/web/src/app/dashboard/accounts/[id]/page.tsx` | Account detail: Authenticated program balance/history, pin/sync controls, manual balance, membership editing, notes/tags and unlink section. |
| `/share/[token]` | `apps/web/src/app/share/[token]/page.tsx` | Public portfolio: Read-only token snapshot with points, estimated values and provider list; hides membership numbers. |

## Extension surface
`apps/extension/public/popup.html` is the browser-action popup, not a web route. A 320px capture/settings panel, driven by `apps/extension/src/popup.ts`.

## HTTP endpoints (not UI pages)
- `/api/health` → `apps/web/src/app/api/health/route.ts`
- `/api/v1/activity` → `apps/web/src/app/api/v1/activity/route.ts`
- `/api/v1/assistant/chat` → `apps/web/src/app/api/v1/assistant/chat/route.ts`
- `/api/v1/calendar.ics` → `apps/web/src/app/api/v1/calendar.ics/route.ts`
- `/api/v1/deals/scrape` → `apps/web/src/app/api/v1/deals/scrape/route.ts`
- `/api/v1/demo` → `apps/web/src/app/api/v1/demo/route.ts`
- `/api/v1/expiring` → `apps/web/src/app/api/v1/expiring/route.ts`
- `/api/v1/export` → `apps/web/src/app/api/v1/export/route.ts`
- `/api/v1/goals/[id]` → `apps/web/src/app/api/v1/goals/[id]/route.ts`
- `/api/v1/goals` → `apps/web/src/app/api/v1/goals/route.ts`
- `/api/v1/import` → `apps/web/src/app/api/v1/import/route.ts`
- `/api/v1/loyalty-accounts/[id]/balances` → `apps/web/src/app/api/v1/loyalty-accounts/[id]/balances/route.ts`
- `/api/v1/loyalty-accounts/[id]/restore` → `apps/web/src/app/api/v1/loyalty-accounts/[id]/restore/route.ts`
- `/api/v1/loyalty-accounts/[id]` → `apps/web/src/app/api/v1/loyalty-accounts/[id]/route.ts`
- `/api/v1/loyalty-accounts/[id]/sync` → `apps/web/src/app/api/v1/loyalty-accounts/[id]/sync/route.ts`
- `/api/v1/loyalty-accounts/deleted` → `apps/web/src/app/api/v1/loyalty-accounts/deleted/route.ts`
- `/api/v1/loyalty-accounts` → `apps/web/src/app/api/v1/loyalty-accounts/route.ts`
- `/api/v1/openapi.json` → `apps/web/src/app/api/v1/openapi.json/route.ts`
- `/api/v1/providers` → `apps/web/src/app/api/v1/providers/route.ts`
- `/api/v1/public/share/[token]` → `apps/web/src/app/api/v1/public/share/[token]/route.ts`
- `/api/v1/settings` → `apps/web/src/app/api/v1/settings/route.ts`
- `/api/v1/shares/[id]` → `apps/web/src/app/api/v1/shares/[id]/route.ts`
- `/api/v1/shares` → `apps/web/src/app/api/v1/shares/route.ts`
- `/api/v1/summary` → `apps/web/src/app/api/v1/summary/route.ts`
- `/api/v1/sync` → `apps/web/src/app/api/v1/sync/route.ts`
- `/api/v1/valuations/[providerId]` → `apps/web/src/app/api/v1/valuations/[providerId]/route.ts`
- `/api/v1/valuations` → `apps/web/src/app/api/v1/valuations/route.ts`
- `/api/v1/value-advice` → `apps/web/src/app/api/v1/value-advice/route.ts`
- `/api/v1/watches/[id]` → `apps/web/src/app/api/v1/watches/[id]/route.ts`
- `/api/v1/watches` → `apps/web/src/app/api/v1/watches/route.ts`

Metadata assets: `apps/web/src/app/icon.svg`, `apps/web/src/app/opengraph-image.tsx`.


Current account-access route: `/dashboard/settings` (authenticated) includes proposed assistant actions, held captured balances, scoped tokens, account-specific capture consent, and ChatGPT identity linking when configured.
