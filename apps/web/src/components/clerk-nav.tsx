import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";

import { NavLinks } from "@/components/nav-links";

/** Clerk-backed header controls. Only loaded (dynamic import) in clerk mode. */
export function ClerkNav() {
  return (
    <>
      <Show when="signed-in">
        <NavLinks />
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
    </>
  );
}
