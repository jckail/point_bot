import {
  assertSupportedDisplayCurrency,
  convertUsdCents,
  type DisplayCurrency,
  type FxRateSource,
} from "../../domain/fx";
import {
  DEFAULT_DISPLAY_CURRENCY,
  type UserSettings,
  type UserSettingsRepository,
} from "../../domain/loyalty/user-settings";
import { userCacheTag, type Cache } from "../cache";
import type { Clock } from "../ports";
import { systemClock } from "../ports";

import type { UserId } from "../../domain/shared/ids";
export class GetUserSettings {
  constructor(private readonly settings: UserSettingsRepository) {}

  async execute(userId: UserId): Promise<UserSettings> {
    return (
      (await this.settings.get(userId)) ?? {
        userId,
        displayCurrency: DEFAULT_DISPLAY_CURRENCY,
        updatedAt: new Date(0),
      }
    );
  }
}

export class SetDisplayCurrency {
  constructor(
    private readonly settings: UserSettingsRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(userId: UserId, currency: string): Promise<UserSettings> {
    const updated: UserSettings = {
      userId,
      displayCurrency: assertSupportedDisplayCurrency(currency),
      updatedAt: this.clock.now(),
    };
    await this.settings.upsert(updated);
    return updated;
  }
}

export interface DisplayValue {
  readonly currency: DisplayCurrency;
  /** Decimal amount in the display currency (2dp; 0dp for JPY). */
  readonly amount: number;
  /** Units of the currency per 1 USD used for the conversion. */
  readonly ratePerUsd: number;
}

/**
 * Converts a USD-cents value into the user's display currency. Returns null
 * for USD (nothing to convert) or when the rate/conversion is unavailable — display
 * conversion is a nice-to-have that must never break the underlying response.
 */
export class BuildDisplayValue {
  constructor(
    private readonly settings: UserSettingsRepository,
    private readonly fx: FxRateSource,
    /** Optional: caches the per-user settings row (see `ListLoyaltyAccounts`). */
    private readonly cache?: Cache,
    private readonly cacheTtlMs = 10_000,
  ) {}

  async execute(
    userId: UserId,
    usdCents: number,
  ): Promise<DisplayValue | null> {
    const settings =
      this.cache && this.cacheTtlMs > 0
        ? await this.cache.remember(
            `settings:${userId}`,
            { ttlMs: this.cacheTtlMs, tags: [userCacheTag(userId)] },
            () => this.settings.get(userId),
          )
        : await this.settings.get(userId);
    const currency = settings?.displayCurrency ?? DEFAULT_DISPLAY_CURRENCY;
    if (currency === "USD") return null;

    try {
      const ratePerUsd = await this.fx.getUsdRate(currency);
      if (!Number.isFinite(ratePerUsd) || ratePerUsd <= 0) return null;
      return {
        currency,
        amount: convertUsdCents(usdCents, currency, ratePerUsd),
        ratePerUsd,
      };
    } catch {
      return null;
    }
  }
}
