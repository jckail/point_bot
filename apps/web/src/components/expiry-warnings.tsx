import type { LoyaltyAccountReadModel } from "@pointup/core";
import Link from "next/link";

import { formatDate } from "@/lib/format";

export function ExpiryWarnings({
  accounts,
}: {
  accounts: LoyaltyAccountReadModel[];
}) {
  if (accounts.length === 0) return null;

  return (
    <section className="card-surface border-gold/30 p-5">
      <h2 className="font-display text-lg font-semibold text-ink">
        Expiring soon
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Balances at risk of inactivity expiry in the next 90 days.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {accounts.map((account) => {
          const days = account.daysUntilExpiry ?? 0;
          const tone =
            days < 0
              ? "text-danger"
              : days <= 30
                ? "text-gold"
                : "text-ink-muted";
          return (
            <li
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <Link
                href={`/dashboard/accounts/${account.id}`}
                className="font-medium text-ink no-underline hover:text-brand-soft"
              >
                {account.provider.displayName}
              </Link>
              <span className={tone}>
                {days < 0
                  ? `Expired ${formatDate(account.expiresAt!)}`
                  : days === 0
                    ? "Expires today"
                    : `${days} day${days === 1 ? "" : "s"} · ${formatDate(account.expiresAt!)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
