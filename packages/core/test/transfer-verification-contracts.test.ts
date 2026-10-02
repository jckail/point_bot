import { describe, expect, it } from "vitest";
import { toTransferOptionDto, transferOptionDtoSchema } from "../src/contracts";
import { createTransferBonus } from "../src/domain/loyalty/transfer-bonus";
import { rankTransferOptions } from "../src/domain/loyalty/transfer-ranking";

const now = new Date("2026-10-15T00:00:00Z");
function option(verifiedAt: Date | null, active = true) {
  const bonus = createTransferBonus({ fromProviderId: "chase-ultimate-rewards", toProviderId: "hyatt",
    multiplierPermille: 1300, startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-31T00:00:00Z"),
    source: "user", sourceUrl: "https://issuer.test/bonus", verifiedAt });
  return rankTransferOptions("chase-ultimate-rewards", 100_000, active ? [bonus] : [], now,
    { cardProductId: "chase-sapphire-preferred" }).find(option => option.to.id === "hyatt")!;
}
describe("transfer bonus verification metadata", () => {
  it("qualifies a bonus used in numeric yields and preserves source through the DTO", () => {
    const ranked = option(null);
    expect(ranked.destinationPoints).toBe(97_500);
    expect(ranked).toMatchObject({ bonusVerified: false, bonusSource: "user" });
    expect(transferOptionDtoSchema.parse(toTransferOptionDto(ranked))).toMatchObject({ bonusVerified: false, bonusSource: "user" });
  });
  it("distinguishes verified bonuses from absence of a bonus", () => {
    expect(toTransferOptionDto(option(now)).bonusVerified).toBe(true);
    expect(toTransferOptionDto(option(null, false))).toMatchObject({ bonusMultiplier: 1, bonusVerified: null, bonusSource: null });
  });
  it("accepts missing legacy metadata without inventing verification", () => {
    const { bonusVerified: _verified, bonusSource: _source, ...legacy } = option(null);
    const dto = transferOptionDtoSchema.parse(toTransferOptionDto(legacy));
    expect(dto.bonusMultiplier).toBe(1.3);
    expect(dto.bonusVerified).toBeUndefined();
    expect(dto.bonusSource).toBeUndefined();
  });
  it("bounds source values and keeps bonus URLs out of transfer advice", () => {
    const dto = toTransferOptionDto(option(null));
    expect(transferOptionDtoSchema.safeParse({ ...dto, bonusSource: "confirmed" }).success).toBe(false);
    expect(dto).not.toHaveProperty("bonusSourceUrl");
    expect(JSON.stringify(dto)).not.toContain("issuer.test");
  });
});
