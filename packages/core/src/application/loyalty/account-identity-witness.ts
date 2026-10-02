import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { manualBalanceAccountWitnessSchema, type ManualBalanceAccountWitness } from "../../domain/loyalty/account-identity-witness";

type AccountIdentity = { readonly id: string; readonly userId: string; readonly providerId: string; readonly membershipNumber: string };

function digest(account: AccountIdentity, nonce: string): string {
  return createHash("sha256").update(JSON.stringify([
    "pointup.manual_balance.account.v1", nonce, account.userId, account.id,
    account.providerId, account.membershipNumber,
  ])).digest("hex");
}

export function createAccountIdentityWitness(account: AccountIdentity): ManualBalanceAccountWitness {
  const nonce = randomBytes(32).toString("base64url");
  return { version: 1, kind: "manual_balance_account_identity", nonce, digest: digest(account, nonce) };
}

export function matchesAccountIdentityWitness(value: unknown, account: AccountIdentity): boolean {
  const parsed = manualBalanceAccountWitnessSchema.safeParse(value);
  if (!parsed.success) return false;
  return timingSafeEqual(Buffer.from(parsed.data.digest, "hex"), Buffer.from(digest(account, parsed.data.nonce), "hex"));
}

/** Thrown only by the synchronous identity guard before any mutation work. */
export class AccountIdentityPreconditionError extends Error {
  constructor() { super("Account identity changed after the proposal. Review a new proposal."); }
}
