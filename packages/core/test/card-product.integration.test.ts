import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { UpdateLoyaltyAccount } from "../src/application/loyalty/update-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { RestoreLoyaltyAccount } from "../src/application/loyalty/restore-loyalty-account";
import { UnlinkLoyaltyAccount } from "../src/application/loyalty/update-loyalty-account";
import { ExportPortfolio } from "../src/application/loyalty/export-portfolio";
import { ImportPortfolio } from "../src/application/loyalty/import-portfolio";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { PlanRedemption } from "../src/application/loyalty/plan-redemption";
import { ListActiveTransferBonuses } from "../src/application/loyalty/transfer-bonuses";
import { GetValueAdvice } from "../src/application/loyalty/assistant";
import { toPortfolioExportCsv } from "../src/contracts/index";
import { CARD_PRODUCT_IDS } from "../src/domain/loyalty/card-products";
import { SWEET_SPOTS } from "../src/domain/loyalty/catalog/sweet-spots";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { UserId } from "../src/domain/shared/ids";
import { createDb } from "../src/infrastructure/db/client";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";
import { StubAwardAvailabilitySource } from "../src/infrastructure/award-search/award-availability-sources";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("explicit transfer cards on production PostgreSQL repositories", () => {
  const prefix = `card-product-${randomUUID()}`;
  const product = "chase-sapphire-preferred" as const;
  const clock = { now: () => new Date("2026-10-02T12:00:00Z") };
  let db: ReturnType<typeof createDb>;
  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Card tests require dedicated loopback postgres/app.");
    }
    db = createDb(url!, { max: 2 });
  });
  afterAll(async () => {
    if (!db) return;
    try {
      for (const table of ["domain_event_outbox", "activity_event", "loyalty_account"]) {
        await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE user_id LIKE ${prefix + "%"}`);
      }
    } finally { await db.$client.end({ timeout: 5 }); }
  });
  async function fixture() {
    const userId = UserId.parse(`${prefix}-${randomUUID()}`);
    let instant = clock.now();
    const fixtureClock = { now: () => new Date(instant) };
    const repos = buildDrizzleRepositories(db);
    const link = new LinkLoyaltyAccount(repos.loyaltyAccounts, repos.activity, fixtureClock, repos.eventing);
    const update = new UpdateLoyaltyAccount(repos.loyaltyAccounts, repos.activity, fixtureClock, repos.eventing);
    const record = new RecordManualBalance(repos.loyaltyAccounts, repos.balanceSnapshots, repos.activity, fixtureClock, repos.eventing);
    const { accountId } = await link.execute({ userId, providerId: "chase-ultimate-rewards", membershipNumber: "synthetic", cardProductId: product });
    return { userId, repos, link, update, record, accountId, clock: fixtureClock, advance: () => { instant = new Date(instant.getTime() + 1000); } };
  }
  it("roundtrips selection and omission, explicit null and foreign-owner denial", async () => {
    const f = await fixture();
    await f.update.execute({ userId: f.userId, accountId: f.accountId, notes: "Sapphire Reserve does not select a card" });
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBe(product);
    await expect(f.update.execute({ userId: UserId.parse(`${prefix}-foreign`), accountId: f.accountId, cardProductId: null })).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBe(product);
    await f.update.execute({ userId: f.userId, accountId: f.accountId, cardProductId: null });
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBeNull();
  });
  it("stale routine updates preserve both a newer selection and a newer clearing", async () => {
    const f = await fixture();
    const stale = (await f.repos.loyaltyAccounts.findById(f.accountId))!;
    await f.update.execute({ userId: f.userId, accountId: f.accountId, cardProductId: "chase-sapphire-reserve" });
    await f.repos.loyaltyAccounts.update({ ...stale, notes: "delayed routine write" });
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBe("chase-sapphire-reserve");
    await f.update.execute({ userId: f.userId, accountId: f.accountId, cardProductId: null });
    await f.repos.loyaltyAccounts.update({ ...stale, notes: "another delayed write" });
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBeNull();
  });
  it("preserves selection through agent/manual balance writes, soft-delete and restore", async () => {
    const f = await fixture();
    await f.record.execute({ userId: f.userId, accountId: f.accountId, points: 40000, source: "agent" });
    await f.record.execute({ userId: f.userId, accountId: f.accountId, points: 41000 });
    await new UnlinkLoyaltyAccount(f.repos.loyaltyAccounts, f.repos.activity, clock, f.repos.eventing).execute(f.userId, f.accountId);
    const restored = await new RestoreLoyaltyAccount(f.repos.loyaltyAccounts, f.repos.balanceSnapshots, f.repos.activity, clock, f.repos.eventing).execute(f.userId, f.accountId);
    expect(restored.cardProductId).toBe(product);
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBe(product);
  });
  it("exports and imports selection into a separate persisted portfolio", async () => {
    const f = await fixture();
    await f.record.execute({ userId: f.userId, accountId: f.accountId, points: 40000 });
    const exported = await new ExportPortfolio(f.repos.loyaltyAccounts, f.repos.balanceSnapshots, clock).execute(f.userId);
    const other = UserId.parse(`${prefix}-${randomUUID()}`);
    await new ImportPortfolio(f.repos.loyaltyAccounts, f.link, f.record, f.clock, f.repos.eventing).execute({ userId: other, csv: toPortfolioExportCsv(exported) });
    expect((await f.repos.loyaltyAccounts.findByUserAndProvider(other, "chase-ultimate-rewards"))?.cardProductId).toBe(product);
  });
  it("selection changes actual persisted advice and funding, with unknown excluded", async () => {
    const f = await fixture();
    await f.record.execute({ userId: f.userId, accountId: f.accountId, points: 40000 });
    const list = new ListLoyaltyAccounts(f.repos.loyaltyAccounts, f.repos.balanceSnapshots, f.clock);
    const bonuses = new ListActiveTransferBonuses(f.repos.transferBonuses, f.clock);
    const advice = new GetValueAdvice(list, bonuses, f.clock);
    const spot = SWEET_SPOTS.find(entry => entry.programId === "hyatt")!;
    const plan = new PlanRedemption(list, bonuses, new StubAwardAvailabilitySource(), f.clock, [{ ...spot, pointsCost: 40000, pointsCostMin: 40000, pointsCostMax: 40000, maxUnits: 1 }]);
    const input = { userId: f.userId, goal: { kind: "hotel" as const, targetProgramId: "hyatt", quantity: 1 } };
    expect((await plan.execute(input)).plans.some(entry => entry.status === "fundable")).toBe(false);
    // Distinct captures must have distinct timestamps; UUIDs are not chronology.
    f.advance();
    await f.record.execute({ userId: f.userId, accountId: f.accountId, points: 54000 });
    expect((await plan.execute(input)).plans.some(entry => entry.status === "fundable")).toBe(true);
    await f.update.execute({ userId: f.userId, accountId: f.accountId, cardProductId: null });
    expect((await plan.execute(input)).plans.some(entry => entry.status === "fundable")).toBe(false);
    expect((await advice.execute(f.userId)).eligibilityWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CARD_PRODUCT_REQUIRED", toProviderId: "hyatt" })]));
  });
  it.each(CARD_PRODUCT_IDS)("database accepts only a compatible provider for %s", async card => {
    const f = await fixture();
    await db.$client`UPDATE loyalty_account SET card_product_id=${card} WHERE id=${f.accountId}`;
    await expect(db.$client`UPDATE loyalty_account SET provider_id='hyatt' WHERE id=${f.accountId}`).rejects.toMatchObject({ code: "23514", constraint_name: "loyalty_account_card_product_check" });
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBe(card);
  });
  it("database rejects an invented product without changing the previous selection", async () => {
    const f = await fixture();
    await expect(db.$client`UPDATE loyalty_account SET card_product_id='invented' WHERE id=${f.accountId}`).rejects.toMatchObject({ code: "23514", constraint_name: "loyalty_account_card_product_check" });
    expect((await f.repos.loyaltyAccounts.findById(f.accountId))?.cardProductId).toBe(product);
  });
});
