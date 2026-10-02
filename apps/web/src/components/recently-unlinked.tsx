import { RestoreAccountForm } from "@/components/restore-account-form";
import { formatDateTime } from "@/lib/format";

type DeletedRow = {
  id: string;
  providerName: string;
  deletedAt: Date;
  restorable: boolean;
};

export function RecentlyUnlinked({ accounts }: { accounts: DeletedRow[] }) {
  const restorable = accounts.filter((account) => account.restorable);
  if (restorable.length === 0) return null;

  return (
    <section className="rounded-2xl border border-dashed border-line px-4 py-3">
      <h2 className="font-display text-sm font-semibold text-ink">
        Recently unlinked
      </h2>
      <p className="mt-0.5 text-xs text-ink-faint">
        Undo within 7 days — balance history is still here.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {restorable.map((account) => (
          <li
            key={account.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="text-ink">
              {account.providerName}
              <span className="ml-2 text-xs text-ink-faint">
                unlinked {formatDateTime(account.deletedAt)}
              </span>
            </span>
            <RestoreAccountForm
              accountId={account.id}
              providerName={account.providerName}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
