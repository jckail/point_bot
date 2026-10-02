import { createHash } from "node:crypto";
import postgres from "postgres";
import { env } from "@/env";
import type { SignInTransaction } from "./oidc";

const shared = globalThis as unknown as { chatGptSql?: ReturnType<typeof postgres> };
function sql() {
  shared.chatGptSql ??= postgres(env.DATABASE_URL, { max: 2 });
  return shared.chatGptSql;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function saveTransaction(browserId: string, transaction: SignInTransaction) {
  const db = sql();
  await db`DELETE FROM pointup_chatgpt_transactions WHERE expires_at <= now()`;
  await db`INSERT INTO pointup_chatgpt_transactions (browser_id_hash, transaction_data, expires_at)
    VALUES (${hash(browserId)}, ${db.json({ ...transaction })}, ${new Date(transaction.expiresAt)})`;
}

/** DELETE RETURNING is an atomic, one-time consume, including invalid callbacks. */
export async function consumeTransaction(browserId: string): Promise<SignInTransaction | null> {
  const rows = await sql()`DELETE FROM pointup_chatgpt_transactions
    WHERE browser_id_hash = ${hash(browserId)} RETURNING transaction_data`;
  return (rows[0]?.transaction_data as SignInTransaction | undefined) ?? null;
}

export async function linkedIdentity(userId: string, clientId: string, issuer: string) {
  const rows = await sql()`SELECT linked_at FROM pointup_chatgpt_identities
    WHERE issuer = ${issuer} AND client_id = ${clientId} AND clerk_user_id = ${userId}`;
  return rows.length > 0;
}

export async function linkIdentity(identity: { issuer: string; clientId: string; subject: string }, userId: string) {
  // Both unique constraints prevent reassignment to another account or replacing
  // an existing link. Email claims never participate in account resolution.
  const rows = await sql()`INSERT INTO pointup_chatgpt_identities (issuer, client_id, subject, clerk_user_id)
    VALUES (${identity.issuer}, ${identity.clientId}, ${identity.subject}, ${userId})
    ON CONFLICT (issuer, client_id, subject) DO UPDATE
      SET clerk_user_id = pointup_chatgpt_identities.clerk_user_id
      WHERE pointup_chatgpt_identities.clerk_user_id = ${userId}
    RETURNING clerk_user_id`;
  if (!rows.length) throw new Error("ChatGPT identity is already linked to another PointUp account.");
}
