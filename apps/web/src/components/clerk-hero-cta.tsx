import { Show, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";

/** Landing-page call to action under Clerk. Only loaded in clerk mode. */
export function ClerkHeroCta() {
  return (
    <>
      <Show when="signed-out">
        <SignUpButton mode="modal">
          <button className="hero-cta">
            Create your portfolio
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <Link
          href="/dashboard"
          className="hero-cta"
        >
          Open your portfolio
        </Link>
      </Show>
    </>
  );
}
