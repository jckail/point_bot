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
import type { Clock } from "../ports";
import { systemClock } from "../ports";

export class GetUserSettings {
  constructor(private readonly settings: UserSettingsRepository) {}

  async execute(userId: string): Promise<UserSettings> {
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

  async execute(userId: string, currency: string): Promise<UserSettings> {
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
 * for USD (nothing to convert) or when the rate source fails — display
 * conversion is a nice-to-have that must never break the underlying response.
 */
export class BuildDisplayValue {
  constructor(
    private readonly settings: UserSettingsRepository,
    private readonly fx: FxRateSource,
  ) {}

  async execute(
    userId: string,
    usdCents: number,
  ): Promise<DisplayValue | null> {
    const settings = await this.settings.get(userId);
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
