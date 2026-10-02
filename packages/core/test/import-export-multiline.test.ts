import { describe, expect, it, vi } from "vitest";
import { ExportPortfolio } from "../src/application/loyalty/export-portfolio";
import { ImportPortfolio } from "../src/application/loyalty/import-portfolio";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { toPortfolioExportCsv } from "../src/contracts";
import { InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository } from "./fakes";
import { asUserId } from "./ids";

const owner = asUserId("csv-owner");
const clock = { now: () => new Date("2026-10-02T12:00:00Z") };
function fixture() {
  const accounts = new InMemoryLoyaltyAccountRepository(), balances = new InMemoryBalanceSnapshotRepository();
  const link = new LinkLoyaltyAccount(accounts, undefined, clock);
  const record = new RecordManualBalance(accounts, balances, undefined, clock);
  return { accounts, balances, link, record, import: new ImportPortfolio(accounts, link, record, clock) };
}

describe("portable CSV logical records", () => {
  it.each([
    "AA123\ncontinued",
    "AA123\r\ncontinued",
    "AA123\rcontinued",
    'AA123,"quoted"\n  continued',
    // This looks like a separate provider row but is one membership field.
    "AA123\nother-id,delta,airline,Delta,DL123,999999,manual,2026-09-01T12:00:00Z,999999,\ncontinued",
  ])("round-trips membership %j and full balance history without inventing records", async membershipNumber => {
    const source = fixture();
    const { accountId } = await source.link.execute({ userId: owner, providerId: "american", membershipNumber });
    for (const [points, capturedAt] of [[600, "2026-09-01T12:00:00Z"], [1200, "2026-09-02T12:00:00Z"]] as const) {
      await source.record.execute({ userId: owner, accountId, points, capturedAt: new Date(capturedAt) });
    }
    const csv = toPortfolioExportCsv(await new ExportPortfolio(source.accounts, source.balances, clock).execute(owner));
    expect(csv).toContain(`"${membershipNumber.replaceAll('"', '""')}"`);
    const destination = fixture();
    expect(await destination.import.execute({ userId: owner, csv }))
      .toEqual({ accountsLinked: 1, balancesRecorded: 2, skippedRows: 0 });
    const [account] = await new ListLoyaltyAccounts(destination.accounts, destination.balances, clock).execute(owner);
    expect(account).toMatchObject({ membershipNumber, provider: { id: "american" }, latestBalance: { points: 1200 } });
    expect(destination.accounts.rows.size).toBe(1);
    expect((await destination.balances.findByAccountId(account!.id, 10)).map(row => [row.points, row.capturedAt.toISOString()]))
      .toEqual([[1200, "2026-09-02T12:00:00.000Z"], [600, "2026-09-01T12:00:00.000Z"]]);
  });

  it.each([
    'american,"unfinished,600,2026-09-01T12:00:00Z',
    'american,AA"broken"member,600,2026-09-01T12:00:00Z',
    'american,"AA123"extra,600,2026-09-01T12:00:00Z',
  ])("rejects malformed quotes in a later record before any account or balance mutation", async malformed => {
    const f = fixture();
    const link = vi.spyOn(f.link, "execute"), record = vi.spyOn(f.record, "execute");
    const csv = ["providerId,membershipNumber,points,capturedAt", "delta,DL123,700,2026-09-01T12:00:00Z", malformed].join("\n");
    await expect(f.import.execute({ userId: owner, csv })).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    expect(link).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
    expect(f.accounts.rows.size).toBe(0); expect(f.balances.rows).toEqual([]);
  });

  it("preserves legacy headers, blank records, CRLF separators and exact scientific points", async () => {
    const f = fixture();
    const csv = '  providerId,membershipNumber,points,capturedAt  \r\n\r\namerican,"AA,123",6e2,2026-09-01T12:00:00Z\r\n   \r\n';
    expect(await f.import.execute({ userId: owner, csv })).toEqual({ accountsLinked: 1, balancesRecorded: 1, skippedRows: 0 });
    expect([...f.accounts.rows.values()][0]?.membershipNumber).toBe("AA,123");
    expect(f.balances.rows[0]?.points).toBe(600);
  });
});
