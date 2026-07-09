import type { PortfolioDigestReadModel } from "./build-portfolio-digest";
import { DEFAULT_EXPIRY_WARNING_DAYS } from "./list-expiring-accounts";

export type AlertType =
  | "expired"
  | "expiring"
  | "goal-reached"
  | "balance-drop"
  | "balance-jump";

export type AlertSeverity = "warning" | "info";

export interface PortfolioAlert {
  readonly type: AlertType;
  readonly severity: AlertSeverity;
  /** One-line, human-readable alert text. */
  readonly message: string;
  readonly providerId?: string;
  readonly goalId?: string;
}

export interface DeriveAlertsOptions {
  /** Flag accounts expiring within this many days. */
  readonly expiryWarningDays?: number;
  /** Minimum |percent| change vs. the previous snapshot to flag (0.2 = 20%). */
  readonly bigChangePercent?: number;
  /** Ignore changes below this many points, to avoid noise on tiny balances. */
  readonly bigChangeMinPoints?: number;
}

const numberFormat = new Intl.NumberFormat("en-US");

/**
 * Pure, stateless derivation of urgent, actionable alerts from the same
 * portfolio digest read model the weekly summary uses. Stateless because the
 * signals it needs are already in the read model: `daysUntilExpiry`, per-account
 * `trend` (delta vs. the previous snapshot), and goal `achieved`. No extra
 * persistence or "last alerted" bookkeeping required.
 *
 * Ordered warnings-first so delivery surfaces can lead with what matters.
 */
export function deriveAlerts(
  digest: PortfolioDigestReadModel,
  options: DeriveAlertsOptions = {},
): PortfolioAlert[] {
  const warningDays = options.expiryWarningDays ?? DEFAULT_EXPIRY_WARNING_DAYS;
  const bigPercent = options.bigChangePercent ?? 0.2;
  const minPoints = options.bigChangeMinPoints ?? 1000;

  const alerts: PortfolioAlert[] = [];

  for (const account of digest.accounts) {
    const name = account.provider.displayName;
    const days = account.daysUntilExpiry;

    if (days !== null && days < 0) {
      alerts.push({
        type: "expired",
        severity: "warning",
        message: `${name} points may have expired — sync or check your account.`,
        providerId: account.provider.id,
      });
    } else if (days !== null && days <= warningDays) {
      alerts.push({
        type: "expiring",
        severity: "warning",
        message: `${name} expires in ${days} day${days === 1 ? "" : "s"} — earn, redeem, or sync to reset the clock.`,
        providerId: account.provider.id,
      });
    }

    const delta = account.trend.sincePrevious;
    if (
      delta &&
      delta.percent !== null &&
      Math.abs(delta.points) >= minPoints &&
      Math.abs(delta.percent) >= bigPercent
    ) {
      const pct = Math.round(Math.abs(delta.percent) * 100);
      if (delta.points < 0) {
        alerts.push({
          type: "balance-drop",
          severity: "warning",
          message: `${name} dropped ${numberFormat.format(-delta.points)} points (−${pct}%) since the last sync.`,
          providerId: account.provider.id,
        });
      } else {
        alerts.push({
          type: "balance-jump",
          severity: "info",
          message: `${name} is up ${numberFormat.format(delta.points)} points (+${pct}%) since the last sync.`,
          providerId: account.provider.id,
        });
      }
    }
  }

  for (const goal of digest.goals) {
    if (goal.achieved) {
      alerts.push({
        type: "goal-reached",
        severity: "info",
        message: `Goal reached: “${goal.title}” — you have enough points to book.`,
        goalId: goal.id,
      });
    }
  }

  // Warnings first, preserving discovery order within each severity.
  return alerts
    .map((alert, index) => ({ alert, index }))
    .sort((a, b) => severityRank(a.alert) - severityRank(b.alert) || a.index - b.index)
    .map(({ alert }) => alert);
}

function severityRank(alert: PortfolioAlert): number {
  return alert.severity === "warning" ? 0 : 1;
}
