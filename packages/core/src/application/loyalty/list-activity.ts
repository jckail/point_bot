import { createActivityEvent } from "../../domain/loyalty/activity";
import type { ActivityEventRepository } from "../../domain/loyalty/repositories";
import type { ActivityEventReadModel } from "./read-models";

export const DEFAULT_ACTIVITY_LIMIT = 50;
export const MAX_ACTIVITY_LIMIT = 200;

export class ListActivity {
  constructor(private readonly activity: ActivityEventRepository) {}

  async execute(
    userId: string,
    limit = DEFAULT_ACTIVITY_LIMIT,
  ): Promise<ActivityEventReadModel[]> {
    const clamped = Math.min(Math.max(1, limit), MAX_ACTIVITY_LIMIT);
    const events = await this.activity.findByUserId(userId, clamped);
    return events.map((event) => ({
      id: event.id,
      type: event.type,
      accountId: event.accountId,
      providerId: event.providerId,
      summary: event.summary,
      occurredAt: event.occurredAt,
    }));
  }
}

/** Helper used by mutating use cases to append a feed entry. */
export async function recordActivity(
  activity: ActivityEventRepository | undefined,
  input: Parameters<typeof createActivityEvent>[0],
): Promise<void> {
  if (!activity) return;
  await activity.insert(createActivityEvent(input));
}
