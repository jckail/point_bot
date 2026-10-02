# Shared layouts

## RootLayout
All web pages inherit ClerkProvider, Sora/Inter font variables, sticky SiteHeader, flexible body and SiteFooter.

Source: `apps/web/src/app/layout.tsx`

```tsx
import "@/styles/globals.css";

import { ClerkProvider } from "@clerk/nextjs";
import { type Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.pointup.io"),
  title: {
    default: "PointUp - all your points, one clear view",
    template: "%s | PointUp",
  },
  description:
    "Track loyalty balances, plan trip goals, and compare estimated redemption value in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#215bcc",
          colorBackground: "#ffffff",
          colorForeground: "#152b46",
          colorMutedForeground: "#4b6077",
          colorInput: "#f3f7fb",
          colorInputForeground: "#152b46",
          colorBorder: "#d4deea",
          borderRadius: "0.75rem",
        },
      }}
    >
      <html lang="en" >
        <body className="flex min-h-screen flex-col font-sans antialiased">
          <a href="#main-content" className="skip-link">Skip to content</a>
          <SiteHeader />
          <div id="main-content" className="flex-1">{children}</div>
          <SiteFooter />
        </body>
      </html>
    </ClerkProvider>
  );
}
```

## SiteHeader
Sticky 64px navigation; signed-in dashboard/user menu or signed-out sign-in/get-started controls.

Source: `apps/web/src/components/site-header.tsx`

```tsx
import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";

import { Logo } from "@/components/logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line site-header backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="no-underline">
          <Logo size={26} />
        </Link>

        <nav aria-label="Main navigation" className="flex items-center gap-2 sm:gap-3">
          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="rounded-full px-2 py-2 text-xs sm:px-4 sm:text-sm font-semibold text-ink-muted no-underline transition hover:text-ink"
            >
              Dashboard
            </Link>
            <Link href="/dashboard/settings" className="rounded-full px-2 py-2 text-xs sm:text-sm font-semibold text-ink-muted hover:text-brand">Settings</Link>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="cursor-pointer rounded-full px-2 py-2 text-xs sm:px-4 sm:text-sm font-semibold text-ink-muted transition hover:text-ink">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="cursor-pointer rounded-full bg-brand px-3 py-2 text-xs sm:px-5 sm:text-sm font-semibold text-white  transition hover:bg-brand-strong">
                Get started
              </button>
            </SignUpButton>
          </Show>
        </nav>
      </div>
    </header>
  );
}
```

## SiteFooter
Brand mark, tagline, source link and architecture text; stacks on narrow screens.

Source: `apps/web/src/components/site-footer.tsx`

```tsx
import { LogoMark } from "@/components/logo";
export function SiteFooter() {
  return <footer className="border-t border-line bg-surface"><div className="mx-auto flex max-w-6xl flex-col justify-between gap-5 px-5 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:px-6"><div className="flex items-center gap-2"><LogoMark size={24}/><span>PointUp. Your next trip starts here.</span></div><a href="https://github.com/jckail/pointup" target="_blank" rel="noreferrer" className="font-medium hover:text-brand">View source on GitHub</a></div></footer>;
}
```

Logo implementation is included in components.md. No sidebar, secondary layout or router configuration file exists.
