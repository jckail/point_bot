# Extractable components

Only per-page state/navigation/visibility/count props are candidates. Visual/content props remain hardcoded to each extracted design instance unless deliberately varied.

## SiteHeader
- Source: `apps/web/src/components/site-header.tsx`
- Category: layout
- Description: Sticky brand/navigation/auth controls.
- Extractable props: signedIn (boolean) to preview auth state; homeHref, dashboardHref if needed.
- Hardcoded: Logo, Dashboard/Sign in/Get started labels, typography and classes.

## SiteFooter
- Source: `apps/web/src/components/site-footer.tsx`
- Category: layout
- Description: Shared brand footer and links.
- Extractable props: None.
- Hardcoded: Tagline, GitHub URL, architecture line, mark, styles.

## RootLayout
- Source: `apps/web/src/app/layout.tsx`
- Category: layout
- Description: Shared shell and font/auth theme setup.
- Extractable props: None; use as shell around page content.
- Hardcoded: Font families, theme, header/footer and body classes.

## Logo
- Source: `apps/web/src/components/logo.tsx`
- Category: basic
- Description: Gradient mark and PointUp wordmark.
- Extractable props: None.
- Hardcoded: Brand text, exact SVG, gradient and selected size.

## Button
- Source: `apps/web/src/components/ui/button.tsx`
- Category: basic
- Description: Four visual button variants and three sizes.
- Extractable props: disabled (boolean) where required.
- Hardcoded: Chosen variant, size, label, styling.

## FormFeedback
- Source: `apps/web/src/components/form-feedback.tsx`
- Category: basic
- Description: Status line for action forms.
- Extractable props: status (idle/error/success).
- Hardcoded: Message text, success/danger colors and status roles.

## SubmitButton
- Source: `apps/web/src/components/form-feedback.tsx`
- Category: basic
- Description: Pending-aware form action.
- Extractable props: pending (boolean).
- Hardcoded: Normal/pending label, selected variant and size.

## ProviderBadge
- Source: `apps/web/src/components/provider-badge.tsx`
- Category: basic
- Description: Provider-kind pill.
- Extractable props: None; extract a chosen kind as a fixed instance.
- Hardcoded: Exact kind SVG, label, border and typography.

## StatCard
- Source: `apps/web/src/components/stat-card.tsx`
- Category: basic
- Description: Consistent portfolio metric.
- Extractable props: None; use fixed representative content.
- Hardcoded: Label, value, hint, surface and typography.

## Sparkline
- Source: `apps/web/src/components/sparkline.tsx`
- Category: basic
- Description: Gradient balance chart used on home/detail.
- Extractable props: None.
- Hardcoded: Representative values, dimensions, gradient, endpoint styling.

## BalanceTrendChips
- Source: `apps/web/src/components/balance-trend.tsx`
- Category: basic
- Description: Balance deltas used by account cards/detail.
- Extractable props: None.
- Hardcoded: Representative delta labels, values and tones.

Page-specific sections are in pages.md dependency trees: AccountGrid/AccountCard, assistant, linking/import, deals, goals and sharing. No separate Input, Dialog, Card, Tabs or Table primitive implementations exist; inputs and sections use direct HTML plus utility classes.


Agent controls draft targets standalone form/review cards. They use native HTML controls; no shared shell extraction or logo position is required for this scoped target.
