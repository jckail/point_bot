import { describe, expect, it } from "vitest";
import { CARD_PRODUCT_IDS, normalizeCardProductId } from "../src/domain/loyalty/card-products";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { UpdateLoyaltyAccount } from "../src/application/loyalty/update-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { ExportPortfolio } from "../src/application/loyalty/export-portfolio";
import { ImportPortfolio } from "../src/application/loyalty/import-portfolio";
import { toLoyaltyAccountDto, toPortfolioExportCsv, linkLoyaltyAccountRequestSchema, updateLoyaltyAccountRequestSchema } from "../src/contracts/index";
import { InMemoryLoyaltyAccountRepository, InMemoryBalanceSnapshotRepository } from "./fakes";
import { asUserId } from "./ids";
const owner = asUserId("card-owner");
const product = "chase-sapphire-preferred" as const;
function fixture() {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const link = new LinkLoyaltyAccount(accounts);
  const record = new RecordManualBalance(accounts, balances);
  return { accounts, balances, link, record };
}
describe("explicit transfer card selection", () => {
  it.each(CARD_PRODUCT_IDS)("accepts %s only for its program", id => {
    expect(normalizeCardProductId("chase-ultimate-rewards", id)).toBe(id);
    expect(() => normalizeCardProductId("amex-membership-rewards", id)).toThrowError(expect.objectContaining({ code: "INVALID_CARD_PRODUCT" }));
  });
  it("rejects invented products and never infers from tags or notes", () => {
    expect(() => normalizeCardProductId("chase-ultimate-rewards", "reserve")).toThrowError(expect.objectContaining({ code: "INVALID_CARD_PRODUCT" }));
    const account = createLoyaltyAccount({ userId: owner, providerId: "chase-ultimate-rewards", membershipNumber: "Reserve", tags: ["reserve"], notes: "legacy Sapphire Reserve" });
    expect(account.cardProductId).toBeNull();
  });
  it("preserves omitted edits and balance writes, clears null and denies foreign edits", async () => {
    const f = fixture();
    const { accountId } = await f.link.execute({ userId: owner, providerId: "chase-ultimate-rewards", membershipNumber: "member", cardProductId: product });
    const update = new UpdateLoyaltyAccount(f.accounts);
    await update.execute({ userId: owner, accountId, notes: "new note" });
    await f.record.execute({ userId: owner, accountId, points: 40000 });
    expect((await f.accounts.findById(accountId))!.cardProductId).toBe(product);
    await expect(update.execute({ userId: asUserId("other"), accountId, cardProductId: null })).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    expect((await f.accounts.findById(accountId))!.cardProductId).toBe(product);
    await update.execute({ userId: owner, accountId, cardProductId: null });
    expect((await f.accounts.findById(accountId))!.cardProductId).toBeNull();
  });
  it("stale routine account updates cannot overwrite a newer selection or explicit clearing", async () => {
    const f = fixture();
    const { accountId } = await f.link.execute({ userId: owner, providerId: "chase-ultimate-rewards", membershipNumber: "member", cardProductId: product });
    const stale = (await f.accounts.findById(accountId))!;
    const update = new UpdateLoyaltyAccount(f.accounts);
    await update.execute({ userId: owner, accountId, cardProductId: "chase-sapphire-reserve" });
    await f.accounts.update({ ...stale, notes: "routine delayed update" });
    expect((await f.accounts.findById(accountId))!.cardProductId).toBe("chase-sapphire-reserve");
    await update.execute({ userId: owner, accountId, cardProductId: null });
    await f.accounts.update({ ...stale, notes: "another delayed update" });
    expect((await f.accounts.findById(accountId))!.cardProductId).toBeNull();
  });

  it("exports explicit selection and restores it into a fresh portfolio", async () => {
    const f = fixture();
    const { accountId } = await f.link.execute({ userId: owner, providerId: "chase-ultimate-rewards", membershipNumber: "member", cardProductId: product });
    await f.record.execute({ userId: owner, accountId, points: 40000 });
    const exported = await new ExportPortfolio(f.accounts, f.balances).execute(owner);
    expect(toLoyaltyAccountDto(exported.accounts[0]!.account).cardProductId).toBe(product);
    const restored = fixture();
    await new ImportPortfolio(restored.accounts, restored.link, restored.record).execute({ userId: owner, csv: toPortfolioExportCsv(exported) });
    expect((await restored.accounts.findByUserAndProvider(owner, "chase-ultimate-rewards"))!.cardProductId).toBe(product);
  });
  it("preflights incompatible or conflicting selections before importing any accounts", async () => {
    const f = fixture();
    const importer = new ImportPortfolio(f.accounts, f.link, f.record);
    await expect(importer.execute({ userId: owner, csv: `providerId,membershipNumber,points,capturedAt,cardProductId\nchase-ultimate-rewards,member,40000,,${product}\nunited,member,10000,,${product}` })).rejects.toMatchObject({ code: "INVALID_CARD_PRODUCT" });
    expect(await f.accounts.findByUserId(owner)).toHaveLength(0);
    await expect(importer.execute({ userId: owner, csv: `providerId,membershipNumber,points,capturedAt,cardProductId\nchase-ultimate-rewards,member,40000,,${product}\nchase-ultimate-rewards,member,30000,,chase-sapphire-reserve` })).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    expect(await f.accounts.findByUserId(owner)).toHaveLength(0);
  });
  it("rejects an explicit Unknown import conflicting with an existing selected card", async () => {
    const f = fixture();
    await f.link.execute({ userId: owner, providerId: "chase-ultimate-rewards", membershipNumber: "member", cardProductId: product });
    await expect(new ImportPortfolio(f.accounts, f.link, f.record).execute({ userId: owner, csv: "providerId,membershipNumber,points,capturedAt,cardProductId\nchase-ultimate-rewards,member,40000,," })).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    expect((await f.accounts.findByUserAndProvider(owner, "chase-ultimate-rewards"))?.cardProductId).toBe(product);
    expect(await f.balances.findByAccountId((await f.accounts.findByUserAndProvider(owner, "chase-ultimate-rewards"))!.id, 10)).toHaveLength(0);
  });
  it("older CSVs preserve explicitly selected existing cards", async () => {
    const f = fixture();
    await f.link.execute({ userId: owner, providerId: "chase-ultimate-rewards", membershipNumber: "member", cardProductId: product });
    await new ImportPortfolio(f.accounts, f.link, f.record).execute({ userId: owner, csv: "providerId,membershipNumber,points,capturedAt\nchase-ultimate-rewards,member,40000," });
    expect((await f.accounts.findByUserAndProvider(owner, "chase-ultimate-rewards"))!.cardProductId).toBe(product);
  });
  it("wire contracts preserve explicit null versus omission and reject invented products", () => {
    expect(linkLoyaltyAccountRequestSchema.parse({ providerId: "chase-ultimate-rewards", membershipNumber: "m", cardProductId: product }).cardProductId).toBe(product);
    expect(updateLoyaltyAccountRequestSchema.parse({ notes: "n" }).cardProductId).toBeUndefined();
    expect(updateLoyaltyAccountRequestSchema.parse({ cardProductId: null }).cardProductId).toBeNull();
    expect(updateLoyaltyAccountRequestSchema.safeParse({ cardProductId: "legacy" }).success).toBe(false);
  });
});
