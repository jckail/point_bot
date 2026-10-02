import { noopEventing, type Eventing } from "../events/ports";
import { normalizeCardProductId, type CardProductId } from "../../domain/loyalty/card-products";
import { InvalidImportError } from "../../domain/errors";
import { isSupportedProvider } from "../../domain/loyalty/provider";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { LinkLoyaltyAccount } from "./link-loyalty-account";
import type { RecordManualBalance } from "./record-manual-balance";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";

import type { UserId } from "../../domain/shared/ids";
export interface ImportPortfolioInput {
  readonly userId: UserId;
  /** Raw CSV text matching the export format from `toPortfolioExportCsv`. */
  readonly csv: string;
}

export interface ImportPortfolioResult {
  readonly accountsLinked: number;
  readonly balancesRecorded: number;
  readonly skippedRows: number;
}

type CsvRow = {
  providerId: string;
  membershipNumber: string;
  points: string;
  capturedAt: string;
  cardProductId?: string;
};

/**
 * Rehydrates accounts + balances from a PointUp CSV export. Existing
 * provider links are reused; only missing accounts are created. Balance
 * rows with points + capturedAt become manual snapshots.
 */
export class ImportPortfolio {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly link: LinkLoyaltyAccount,
    private readonly recordBalance: RecordManualBalance,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(input: ImportPortfolioInput): Promise<ImportPortfolioResult> {
    const rows = parseExportCsv(input.csv);
    if (rows.length === 0) {
      throw new InvalidImportError("CSV has no data rows");
    }

    if (Boolean(this.accounts.lockByUserAndProvider) !== this.eventing.unitOfWork.atomic) {
      throw new Error("Portfolio imports require an atomic unit of work and provider locking");
    }
    return this.eventing.unitOfWork.run(async () => {
      let accountsLinked = 0;
      let balancesRecorded = 0;
      let skippedRows = 0;

      // Group by provider so we link once, then record every balance row.
      const byProvider = new Map<string, CsvRow[]>();
      for (const row of rows) {
        if (!row.providerId || !isSupportedProvider(row.providerId)) {
          skippedRows += 1;
          continue;
        }
        const group = byProvider.get(row.providerId) ?? [];
        group.push(row);
        byProvider.set(row.providerId, group);
      }

      // Validate every explicit product selection before any account/balance write.
      // Older CSVs have no column and therefore preserve an existing selection.
      const products = new Map<string, CardProductId | null>();
      const lockedAccounts = new Map<string, Awaited<ReturnType<LoyaltyAccountRepository["findByUserAndProvider"]>>>();
      const orderedProviders = [...byProvider].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      for (const [providerId, providerRows] of orderedProviders) {
        const choices = new Set(providerRows.filter(row => row.cardProductId !== undefined)
          .map(row => normalizeCardProductId(providerId, row.cardProductId || null)));
        if (choices.size > 1) throw new InvalidImportError("conflicting card products for a program");
        if (choices.size === 1) products.set(providerId, choices.values().next().value ?? null);
        const existing = this.accounts.lockByUserAndProvider
          ? await this.accounts.lockByUserAndProvider(input.userId, providerId)
          : await this.accounts.findByUserAndProvider(input.userId, providerId);
        if (existing && (existing.userId !== input.userId || existing.providerId !== providerId || existing.deletedAt)) {
          throw new InvalidImportError("program is not available for import; restore it explicitly first");
        }
        lockedAccounts.set(providerId, existing);
        const explicit = products.get(providerId);
        if (products.has(providerId) && existing && (existing.cardProductId ?? null) !== explicit) {
          throw new InvalidImportError("existing program has a different card selection; edit it explicitly before importing");
        }
      }

      for (const [providerId, providerRows] of orderedProviders) {
        const membership =
          providerRows.find((row) => row.membershipNumber.trim().length > 0)
            ?.membershipNumber ?? `imported-${providerId}`;

        let account = lockedAccounts.get(providerId) ?? null;
        if (!account) {
          const linked = await this.link.execute({
            userId: input.userId,
            providerId,
            membershipNumber: membership,
            cardProductId: products.get(providerId),
          });
          account = await this.accounts.findById(linked.accountId);
          accountsLinked += 1;
        }
        if (!account) continue;

        for (const row of providerRows) {
          if (!row.points || row.points.trim() === "") {
            skippedRows += 1;
            continue;
          }
          const points = parseImportedPoints(row.points);
          if (points === null) {
            skippedRows += 1;
            continue;
          }

          let capturedAt: Date | undefined;
          if (row.capturedAt) {
            const parsed = new Date(row.capturedAt);
            if (Number.isNaN(parsed.getTime())) {
              skippedRows += 1;
              continue;
            }
            // Clamp future timestamps to now so re-imports of fresh exports work.
            const now = this.clock.now();
            capturedAt = parsed.getTime() > now.getTime() ? now : parsed;
          }

          await this.recordBalance.execute({
            userId: input.userId,
            accountId: account.id,
            points,
            capturedAt,
          });
          balancesRecorded += 1;
        }
      }

      return { accountsLinked, balancesRecorded, skippedRows };
    });
  }
}

/** Exact decimal CSV numbers, including integral scientific notation. */
export function parseImportedPoints(input: string): number | null {
  const text = input.trim();
  if (text.length > 1024) return null;
  const match = /^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0") - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1024) return null;
  let exact = BigInt(match[1]! + fraction);
  if (exponent < 0) {
    const divisor = 10n ** BigInt(-exponent);
    if (exact % divisor !== 0n) return null;
    exact /= divisor;
  } else {
    exact *= 10n ** BigInt(exponent);
  }
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(exact);
}

function parseExportCsv(csv: string): CsvRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]!);
  const indexOf = (name: string) => {
    const idx = header.indexOf(name);
    if (idx < 0) {
      throw new InvalidImportError(`missing column "${name}"`);
    }
    return idx;
  };

  const providerIdIdx = indexOf("providerId");
  const membershipIdx = indexOf("membershipNumber");
  const pointsIdx = indexOf("points");
  const capturedAtIdx = indexOf("capturedAt");
  const cardProductIdx = header.indexOf("cardProductId");

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    rows.push({
      providerId: cols[providerIdIdx] ?? "",
      membershipNumber: cols[membershipIdx] ?? "",
      points: cols[pointsIdx] ?? "",
      capturedAt: cols[capturedAtIdx] ?? "",
      ...(cardProductIdx >= 0 ? { cardProductId: cols[cardProductIdx] ?? "" } : {}),
    });
  }
  return rows;
}

/** Minimal RFC-4180-ish CSV line parser (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
