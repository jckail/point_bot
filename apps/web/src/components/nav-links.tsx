import Link from "next/link";

const LINK =
  "rounded-full px-4 py-2 text-sm font-semibold text-ink-muted no-underline transition hover:text-ink";

export function NavLinks() {
  return (
    <>
      <Link href="/dashboard" className={LINK}>
        Dashboard
      </Link>
      <Link href="/dashboard/agents" className={LINK}>
        Agents
      </Link>
      <Link href="/dashboard/settings" className={LINK}>
        Settings
      </Link>
      <span className="hidden text-xs text-ink-faint sm:inline">
        Ask PointUp on the dashboard
      </span>
    </>
  );
}
