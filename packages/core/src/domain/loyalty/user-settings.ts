import type { DisplayCurrency } from "../fx";

import type { UserId } from "../shared/ids";
/**
 * Per-user display preferences. Deliberately tiny: one row per user, extended
 * column-by-column as preferences accrue (notification prefs are a natural
 * next tenant).
 */
export interface UserSettings {
  readonly userId: UserId;
  readonly displayCurrency: DisplayCurrency;
  readonly updatedAt: Date;
}

export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = "USD";

export interface UserSettingsRepository {
  /** Null when the user has never saved settings (callers apply defaults). */
  get(userId: UserId): Promise<UserSettings | null>;
  upsert(settings: UserSettings): Promise<void>;
}
