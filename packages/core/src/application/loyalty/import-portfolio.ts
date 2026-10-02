import type { PortfolioUnitOfWork } from "./portfolio-unit-of-work";
import { InvalidImportError } from "../../domain/errors";
import { isSupportedProvider } from "../../domain/loyalty/provider";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import { LinkLoyaltyAccount } from "./link-loyalty-account";
import { RecordManualBalance } from "./record-manual-balance";
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
    private readonly unitOfWork?: PortfolioUnitOfWork,
  ) {}

  async execute(input: ImportPortfolioInput): Promise<ImportPortfolioResult> {
    if (this.unitOfWork) {
      return this.unitOfWork.run(input.userId, ({ accounts, balances, activity }) =>
        new ImportPortfolio(accounts, new LinkLoyaltyAccount(accounts, activity, this.clock),
          new RecordManualBalance(accounts, balances, activity, this.clock), this.clock).execute(input));
    }
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

    // Preflight identities before writing: a provider link represents one
    // membership, so merging another member's exported balances corrupts it.
    for (const [providerId, providerRows] of byProvider) {
      const memberships = new Set(providerRows.map((row) => row.membershipNumber.trim()).filter(Boolean));
      const existing = await this.accounts.findByUserAndProvider(input.userId, providerId);
      if (memberships.size > 1 || (existing && memberships.size > 0 && !memberships.has(existing.membershipNumber))) {
        throw new InvalidImportError(`conflicting membership for provider "${providerId}"`);
      }
    }

    for (const [providerId, providerRows] of byProvider) {
      const membership =
        providerRows.find((row) => row.membershipNumber.trim().length > 0)
          ?.membershipNumber ?? `imported-${providerId}`;

      let account = await this.accounts.findByUserAndProvider(
        input.userId,
        providerId,
      );
      // Recheck the account used for writes: a legacy/nontransactional writer
      // may have created a missing provider link since the initial preflight.
      const memberships = new Set(providerRows.map((row) => row.membershipNumber.trim()).filter(Boolean));
      if (account && memberships.size > 0 && !memberships.has(account.membershipNumber)) {
        throw new InvalidImportError(`conflicting membership for provider "${providerId}"`);
      }
      if (!account) {
        const linked = await this.link.execute({
          userId: input.userId,
          providerId,
          membershipNumber: membership,
        });
        account = await this.accounts.findById(linked.accountId);
        accountsLinked += 1;
      }
      if (!account || account.deletedAt) {
        skippedRows += providerRows.length;
        continue;
      }

      for (const row of providerRows) {
        if (!row.points || row.points.trim() === "") {
          skippedRows += 1;
          continue;
        }
        const points = Number(row.points);
        if (!Number.isSafeInteger(points) || points < 0) {
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
          // Preserve chronology; future observations cannot be silently rewritten.
          if (parsed.getTime() > this.clock.now().getTime()) {
            skippedRows += 1;
            continue;
          }
          capturedAt = parsed;
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
  const records = parseCsvRecords(csv.replace(/^\uFEFF/, ""));
  if (records.length < 2) return [];
  const header = records[0]!;
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
  for (const cols of records.slice(1)) {
    if (cols.length !== header.length) {
      throw new InvalidImportError("CSV row has an unexpected number of columns");
    }
    rows.push({
      providerId: cols[providerIdIdx] ?? "",
      membershipNumber: cols[membershipIdx] ?? "",
      points: cols[pointsIdx] ?? "",
      capturedAt: cols[capturedAtIdx] ?? "",
    });
  }
  return rows;
}

/** Parses complete RFC-4180 records, including escaped quotes and newlines. */
function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let closedQuote = false;
  const finishField = () => {
    fields.push(current);
    current = "";
    closedQuote = false;
  };
  const finishRecord = () => {
    finishField();
    if (fields.some((field) => field.length > 0)) records.push(fields);
    fields = [];
  };
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        current += ch;
      }
    } else if (ch === ",") {
      finishField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && csv[i + 1] === "\n") i += 1;
      finishRecord();
    } else if (ch === '"' && current.length === 0 && !closedQuote) {
      inQuotes = true;
    } else {
      if (closedQuote || ch === '"') {
        throw new InvalidImportError("malformed quoted CSV field");
      }
      current += ch;
    }
  }
  if (inQuotes) throw new InvalidImportError("unterminated quoted CSV field");
  if (fields.length > 0 || current.length > 0 || closedQuote) finishRecord();
  return records;
}
