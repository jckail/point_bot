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
    <header className="sticky top-0 z-40 border-b border-line bg-midnight/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="no-underline">
          <Logo size={30} />
        </Link>

        <nav className="flex items-center gap-3">
          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="rounded-full px-4 py-2 text-sm font-semibold text-ink-muted no-underline transition hover:text-ink"
            >
              Dashboard
            </Link>
            <span className="hidden text-xs text-ink-faint sm:inline">
              Ask PointUp on the dashboard
            </span>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="cursor-pointer rounded-full px-4 py-2 text-sm font-semibold text-ink-muted transition hover:text-ink">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="cursor-pointer rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-strong">
                Get started
              </button>
            </SignUpButton>
          </Show>
        </nav>
      </div>
    </header>
  );
}
