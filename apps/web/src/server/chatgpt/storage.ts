import { createHash } from "node:crypto";
import type { UserId } from "@pointup/core";
import { sql } from "drizzle-orm";
import { getContainer } from "../container";
import type { SignInTransaction } from "./oidc";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Reuse PR14's database handle, connection tuning and bounded pool. */
export async function saveTransaction(browserId: string, transaction: SignInTransaction) {
  const db = getContainer().db;
  await db.execute(sql`DELETE FROM pointup_chatgpt_transactions WHERE expires_at <= now()`);
  await db.execute(sql`INSERT INTO pointup_chatgpt_transactions (browser_id_hash, transaction_data, expires_at)
    VALUES (${hash(browserId)}, ${JSON.stringify(transaction)}::jsonb, ${new Date(transaction.expiresAt).toISOString()}::timestamptz)`);
}

/** Atomic one-time consumption across instances, including invalid callbacks. */
export async function consumeTransaction(browserId: string): Promise<SignInTransaction | null> {
  const rows = await getContainer().db.execute<{ transaction_data: SignInTransaction }>(sql`DELETE FROM pointup_chatgpt_transactions
    WHERE browser_id_hash = ${hash(browserId)} RETURNING transaction_data`);
  return rows[0]?.transaction_data ?? null;
}

export async function linkedIdentity(userId: UserId, clientId: string, issuer: string) {
  const rows = await getContainer().db.execute(sql`SELECT linked_at FROM pointup_chatgpt_identities
    WHERE issuer = ${issuer} AND client_id = ${clientId} AND clerk_user_id = ${userId}`);
  return rows.length > 0;
}

export async function linkIdentity(identity: { issuer: string; clientId: string; subject: string }, userId: UserId) {
  // Subject and owner uniqueness prevent reassignment; emails never resolve owners.
  const rows = await getContainer().db.execute(sql`INSERT INTO pointup_chatgpt_identities (issuer, client_id, subject, clerk_user_id)
    VALUES (${identity.issuer}, ${identity.clientId}, ${identity.subject}, ${userId})
    ON CONFLICT (issuer, client_id, subject) DO UPDATE
      SET clerk_user_id = pointup_chatgpt_identities.clerk_user_id
      WHERE pointup_chatgpt_identities.clerk_user_id = ${userId}
    RETURNING clerk_user_id`);
  if (!rows.length) throw new Error("ChatGPT identity could not be linked.");
}
