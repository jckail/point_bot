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
          <button className="site-nav-link">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong">
            Get started
          </button>
        </SignUpButton>
      </Show>
    </>
  );
}
