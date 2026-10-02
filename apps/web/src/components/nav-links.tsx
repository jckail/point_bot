"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function NavLinks() {
  const pathname = usePathname();
  return <>{destinations.map(({ href, label }) => (
    <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className="site-nav-link">{label}</Link>
  ))}</>;
}
