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
