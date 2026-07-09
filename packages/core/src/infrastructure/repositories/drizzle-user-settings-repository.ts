import { eq } from "drizzle-orm";

import { assertSupportedDisplayCurrency } from "../../domain/fx";
import type {
  UserSettings,
  UserSettingsRepository,
} from "../../domain/loyalty/user-settings";
import type { Database } from "../db/client";
import { userSettings } from "../db/schema";

export class DrizzleUserSettingsRepository implements UserSettingsRepository {
  constructor(private readonly db: Database) {}

  async get(userId: string): Promise<UserSettings | null> {
    const rows = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.userId,
      // Validate on read so a bad row degrades loudly, not silently.
      displayCurrency: assertSupportedDisplayCurrency(row.displayCurrency),
      updatedAt: row.updatedAt,
    };
  }

  async upsert(settings: UserSettings): Promise<void> {
    await this.db
      .insert(userSettings)
      .values({
        userId: settings.userId,
        displayCurrency: settings.displayCurrency,
        updatedAt: settings.updatedAt,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          displayCurrency: settings.displayCurrency,
          updatedAt: settings.updatedAt,
        },
      });
  }
}
