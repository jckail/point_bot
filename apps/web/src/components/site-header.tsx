import Link from "next/link";

import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { isDevAuth } from "@/server/auth";

export async function SiteHeader() {
  // Clerk components are imported only in clerk mode so dev mode never loads
  // Clerk (and needs no Clerk keys).
  const ClerkNav = isDevAuth()
    ? null
    : (await import("@/components/clerk-nav")).ClerkNav;

  return (
    <header className="site-header sticky top-0 z-40 border-b border-line backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 sm:px-6">
        <Link href="/" className="no-underline">
          <Logo size={30} />
        </Link>

        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-1">
          {ClerkNav ? (
            <ClerkNav />
          ) : (
            <>
              <NavLinks />
              <span
                title="AUTH_PROVIDER=dev: no sign-in, fixed local user"
                className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink-faint"
              >
                Dev mode
              </span>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
