import { createHash } from "node:crypto";
import { UserId } from "@pointup/core";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTransaction } from "./oidc";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../container", () => ({ getContainer: () => ({ db: { execute } }) }));
import { consumeTransaction, linkedIdentity, linkIdentity, saveTransaction } from "./storage";
const dialect = new PgDialect();
beforeEach(() => { vi.resetAllMocks(); execute.mockResolvedValue([]); });

describe("ChatGPT storage composition", () => {
  it("binds a hashed browser identifier and the owner transaction through the existing database handle", async () => {
    const browserId = "synthetic-browser-id";
    const transaction = createTransaction(UserId.parse("synthetic-owner"), "https://pointup.test/api/auth/chatgpt/callback");
    await saveTransaction(browserId, transaction);
    expect(execute).toHaveBeenCalledTimes(2);
    const cleanup = dialect.sqlToQuery(execute.mock.calls[0]?.[0]);
    expect(cleanup.sql).toContain("expires_at <= now()");
    const insert = dialect.sqlToQuery(execute.mock.calls[1]?.[0]);
    expect(insert.params).toEqual([createHash("sha256").update(browserId).digest("hex"), JSON.stringify(transaction), new Date(transaction.expiresAt).toISOString()]);
    expect(insert.sql).toContain("::timestamptz");
    expect(insert.sql).not.toContain(browserId);
    expect(insert.sql).not.toContain(transaction.codeVerifier);
  });
  it("uses one DELETE RETURNING operation for consume and represents replay as missing", async () => {
    const transaction = createTransaction(UserId.parse("synthetic-owner"), "https://pointup.test/api/auth/chatgpt/callback");
    execute.mockResolvedValueOnce([{ transaction_data: transaction }]);
    await expect(consumeTransaction("synthetic-browser-id")).resolves.toBe(transaction);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dialect.sqlToQuery(execute.mock.calls[0]?.[0]).sql).toMatch(/DELETE FROM pointup_chatgpt_transactions[\s\S]*RETURNING transaction_data/);
    await expect(consumeTransaction("synthetic-browser-id")).resolves.toBeNull();
  });
  it("keeps issuer/client/subject and owner parameters scoped without email-based resolution", async () => {
    const owner = UserId.parse("synthetic-owner");
    const identity = { issuer: "https://auth.openai.com", clientId: "oaiapp_synthetic", subject: "synthetic-subject" };
    execute.mockResolvedValueOnce([{ clerk_user_id: owner }]);
    await linkIdentity(identity, owner);
    const query = dialect.sqlToQuery(execute.mock.calls[0]?.[0]);
    expect(query.params).toEqual([identity.issuer, identity.clientId, identity.subject, owner, owner]);
    expect(query.sql).toContain("SET clerk_user_id = pointup_chatgpt_identities.clerk_user_id");
    expect(query.sql).not.toContain("email");
    await expect(linkIdentity(identity, UserId.parse("foreign-owner"))).rejects.toThrow("could not be linked");
    expect(await linkedIdentity(owner, identity.clientId, identity.issuer)).toBe(false);
  });
});
