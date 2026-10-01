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
    <header className="sticky top-0 z-40 border-b border-line bg-midnight/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="no-underline">
          <Logo size={30} />
        </Link>

        <nav className="flex items-center gap-3">
          {ClerkNav ? (
            <ClerkNav />
          ) : (
            <>
              <NavLinks />
              <span
                title="AUTH_PROVIDER=dev: no sign-in, fixed local user"
                className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-faint"
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
