import { InvalidCardProductError } from "../errors";

/** Explicit user-selected transfer card; selection does not verify ownership. */
export const CARD_PRODUCT_IDS = [
  "chase-sapphire-preferred", "chase-sapphire-reserve", "chase-ink-business-preferred",
  "chase-ink-plus", "chase-corporate-flex",
] as const;
export type CardProductId = (typeof CARD_PRODUCT_IDS)[number];
export const CARD_PRODUCTS = [
  { id: "chase-sapphire-preferred", providerId: "chase-ultimate-rewards", displayName: "Chase Sapphire Preferred", label: "Chase Sapphire Preferred" },
  { id: "chase-sapphire-reserve", providerId: "chase-ultimate-rewards", displayName: "Chase Sapphire Reserve", label: "Chase Sapphire Reserve" },
  { id: "chase-ink-business-preferred", providerId: "chase-ultimate-rewards", displayName: "Chase Ink Business Preferred", label: "Chase Ink Business Preferred" },
  { id: "chase-ink-plus", providerId: "chase-ultimate-rewards", displayName: "Chase Ink Plus", label: "Chase Ink Plus" },
  { id: "chase-corporate-flex", providerId: "chase-ultimate-rewards", displayName: "Chase Corporate Flex", label: "Chase Corporate Flex" },
] as const;
export function findCardProduct(id: string) { return CARD_PRODUCTS.find(product => product.id === id); }
export function normalizeCardProductId(providerId: string, value: unknown): CardProductId | null {
  if (value == null) return null;
  const product = typeof value === "string" ? findCardProduct(value) : undefined;
  if (!product || product.providerId !== providerId) throw new InvalidCardProductError();
  return product.id;
}
