import { InvalidImportError } from "../../domain/errors";
import { isSupportedProvider } from "../../domain/loyalty/provider";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { LinkLoyaltyAccount } from "./link-loyalty-account";
import type { RecordManualBalance } from "./record-manual-balance";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";

export interface ImportPortfolioInput {
  readonly userId: string;
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
  ) {}

  async execute(input: ImportPortfolioInput): Promise<ImportPortfolioResult> {
    const rows = parseExportCsv(input.csv);
    if (rows.length === 0) {
      throw new InvalidImportError("CSV has no data rows");
    }

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

    for (const [providerId, providerRows] of byProvider) {
      const membership =
        providerRows.find((row) => row.membershipNumber.trim().length > 0)
          ?.membershipNumber ?? `imported-${providerId}`;

      let account = await this.accounts.findByUserAndProvider(
        input.userId,
        providerId,
      );
      if (!account) {
        const linked = await this.link.execute({
          userId: input.userId,
          providerId,
          membershipNumber: membership,
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
        const points = Number(row.points);
        if (!Number.isInteger(points) || points < 0) {
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
  }
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

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    rows.push({
      providerId: cols[providerIdIdx] ?? "",
      membershipNumber: cols[membershipIdx] ?? "",
      points: cols[pointsIdx] ?? "",
      capturedAt: cols[capturedAtIdx] ?? "",
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
