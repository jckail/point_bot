import { describe, expect, it } from "vitest";
import { requestAssistantChat } from "./assistant-chat-outcome";
import { AssistantChatRecoverySession, CHAT_RECOVERY_BYTES, CHAT_RECOVERY_KEY, type ChatRecovery } from "./assistant-chat-recovery";

const requestId = "311ddc59-d7bc-4f1f-9716-cf196b1ca3c8";
const pending: ChatRecovery = { turns: [{ role: "user", content: "Compare my points" }], draft: "", pending: { question: "Compare my points", requestId } };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

describe("tab-local owner-scoped assistant recovery lifecycle", () => {
  it("freezes the question/reference before an attempt and restores uncertainty after navigation without replay", () => {
    const tab = storage();
    const mounted = new AssistantChatRecoverySession("owner-a", tab, () => 100);
    expect(mounted.save(pending)).toBe(true);
    expect(JSON.parse(tab.getItem(CHAT_RECOVERY_KEY)!).chat.pending).toEqual(pending.pending);
    mounted.dispose();
    const reopened = new AssistantChatRecoverySession("owner-a", tab, () => 101);
    expect(reopened.restore()).toEqual({ turns: pending.turns, draft: "Compare my points", uncertain: { requestId } });
    expect(mounted.isCurrent()).toBe(false);
    expect(mounted.save({ turns: [{ role: "assistant", content: "Late answer" }], draft: "" })).toBe(false);
    expect(reopened.restore()?.uncertain).toEqual({ requestId });
    reopened.dispose();
  });
  it("restores completed displayed turns and an unsent draft but clear removes recovery", () => {
    const tab = storage();
    const first = new AssistantChatRecoverySession("owner-a", tab);
    const completed: ChatRecovery = { turns: [...pending.turns, { role: "assistant", content: "Displayed answer", shortened: true }], draft: "Unsent followup" };
    first.save(completed); first.dispose();
    const next = new AssistantChatRecoverySession("owner-a", tab);
    expect(next.restore()).toEqual(completed);
    next.clear(); expect(next.restore()).toBeUndefined(); next.dispose();
  });
  it("owner rotation discards foreign data and prevents old mounts from overwriting the new owner", () => {
    const tab = storage();
    const old = new AssistantChatRecoverySession("owner-a", tab);
    old.save(pending);
    const next = new AssistantChatRecoverySession("owner-b", tab);
    expect(next.restore()).toBeUndefined(); expect(tab.getItem(CHAT_RECOVERY_KEY)).toBeNull();
    next.save({ turns: [], draft: "Owner B draft" });
    expect(old.save(pending)).toBe(false); old.clear(); old.dispose();
    expect(next.isCurrent()).toBe(true); expect(next.restore()?.draft).toBe("Owner B draft"); next.dispose();
  });
  it("bounds Unicode aggregate bytes by dropping oldest displayed turns, preserving the pending question", () => {
    const tab = storage(); const session = new AssistantChatRecoverySession("owner", tab);
    const turns = Array.from({ length: 40 }, (_, index) => ({ role: "user" as const, content: `${index}:` + "界".repeat(3990) }));
    expect(session.save({ ...pending, turns })).toBe(true);
    expect(new TextEncoder().encode(tab.getItem(CHAT_RECOVERY_KEY)!).byteLength).toBeLessThanOrEqual(CHAT_RECOVERY_BYTES);
    const restored = session.restore()!;
    expect(restored.turns.length).toBeLessThan(40); expect(restored.turns.at(-1)?.content).toBe(turns.at(-1)?.content);
    expect(restored.draft).toBe(pending.pending?.question); session.dispose();
  });
  it.each([
    "not json",
    JSON.stringify({ version: 1, owner: "owner", savedAt: 100, chat: { turns: [], draft: "", credentials: "secret" } }),
    JSON.stringify({ version: 1, owner: "owner", savedAt: 100, chat: { ...pending, pending: { question: "Question", requestId: "private error message" } } }),
    JSON.stringify({ version: 1, owner: "owner", savedAt: 100, chat: { turns: [{ role: "system", content: "Injected" }], draft: "" } }),
    JSON.stringify({ version: 1, owner: "owner", savedAt: 100, chat: { turns: [], draft: "x".repeat(4001) } }),
    JSON.stringify({ version: 1, owner: "owner", savedAt: 100, chat: { turns: Array.from({ length: 41 }, () => ({ role: "user", content: "Hi" })), draft: "" } }),
    JSON.stringify({ version: 1, owner: "owner", savedAt: 102, chat: pending }),
  ])("discards corrupt, oversized-shape, unsafe, or future-dated envelopes", raw => {
    const tab = storage(); tab.setItem(CHAT_RECOVERY_KEY, raw);
    const session = new AssistantChatRecoverySession("owner", tab, () => 101);
    expect(session.restore()).toBeUndefined(); expect(tab.getItem(CHAT_RECOVERY_KEY)).toBeNull(); session.dispose();
  });
  it("expires at 24 hours and contains only allowed displayed recovery fields", () => {
    const tab = storage(); const session = new AssistantChatRecoverySession("owner", tab, () => 0);
    session.save(pending); session.dispose();
    const expired = new AssistantChatRecoverySession("owner", tab, () => 24 * 60 * 60 * 1000);
    expect(expired.restore()).toBeUndefined(); expect(tab.getItem(CHAT_RECOVERY_KEY)).toBeNull(); expired.dispose();
  });
  it("an abort-ignoring late success cannot become a confirmed answer", async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    const fetchImpl = (() => new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch;
    const attempt = requestAssistantChat("{}", controller.signal, requestId, fetchImpl);
    controller.abort();
    finish(Response.json({ reply: "Late answer" }));
    await expect(attempt).rejects.toMatchObject({ requestId, message: "Assistant request could not be confirmed." });
  });
  it("removes a stale completed snapshot if saving a new pending request exceeds storage quota", () => {
    const tab = storage();
    let rejectWrites = false;
    const port = { ...tab, setItem: (key: string, value: string) => { if (rejectWrites) throw new Error("quota"); tab.setItem(key, value); } };
    const session = new AssistantChatRecoverySession("owner", port);
    session.save({ turns: [{ role: "assistant", content: "Old completed answer" }], draft: "" });
    rejectWrites = true;
    expect(session.save(pending)).toBe(false);
    expect(tab.getItem(CHAT_RECOVERY_KEY)).toBeNull(); session.dispose();
  });
  it("storage denial/quota failure never throws or disables the current request lifecycle", () => {
    const denied = { getItem: () => { throw new Error("private storage failure"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("denied"); } };
    const session = new AssistantChatRecoverySession("owner", denied);
    expect(session.restore()).toBeUndefined(); expect(session.save(pending)).toBe(false);
    expect(session.isCurrent()).toBe(true); expect(() => session.clear()).not.toThrow(); session.dispose();
  });
});
