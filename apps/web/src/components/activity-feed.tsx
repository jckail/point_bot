import type { ActivityEventReadModel } from "@pointup/core";

import { formatDateTime } from "@/lib/format";

const TYPE_LABELS: Record<ActivityEventReadModel["type"], string> = {
  account_linked: "Linked",
  account_unlinked: "Unlinked",
  account_updated: "Updated",
  account_restored: "Restored",
  balance_synced: "Synced",
  balance_manual: "Manual",
};

export function ActivityFeed({
  events,
}: {
  events: ActivityEventReadModel[];
}) {
  if (events.length === 0) {
    return (
      <section className="card-surface p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Recent activity
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Syncs, links, and manual entries will show up here.
        </p>
      </section>
    );
  }

  return (
    <section className="card-surface p-5">
      <h2 className="font-display text-lg font-semibold text-ink">
        Recent activity
      </h2>
      <ul className="mt-4 flex flex-col divide-y divide-line">
        {events.map((event) => (
          <li
            key={event.id}
            className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm"
          >
            <div>
              <span className="mr-2 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink-faint">
                {TYPE_LABELS[event.type]}
              </span>
              <span className="text-ink">{event.summary}</span>
            </div>
            <time className="text-xs text-ink-faint">
              {formatDateTime(event.occurredAt)}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
