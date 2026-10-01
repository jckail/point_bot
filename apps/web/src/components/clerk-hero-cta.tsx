import { Show, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";

/** Landing-page call to action under Clerk. Only loaded in clerk mode. */
export function ClerkHeroCta() {
  return (
    <>
      <Show when="signed-out">
        <SignUpButton mode="modal">
          <button className="cursor-pointer rounded-full bg-brand px-8 py-3 font-semibold text-white shadow-xl shadow-brand/30 transition hover:bg-brand-strong">
            Start tracking free
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <Link
          href="/dashboard"
          className="rounded-full bg-brand px-8 py-3 font-semibold text-white no-underline shadow-xl shadow-brand/30 transition hover:bg-brand-strong"
        >
          Open your dashboard
        </Link>
      </Show>
    </>
  );
}
