import { assistantSupportId } from "./assistant-chat-outcome";

export type RecoveredChatTurn = { role: "user" | "assistant"; content: string; shortened?: boolean };
export type ChatRecovery = {
  turns: RecoveredChatTurn[];
  draft: string;
  uncertain?: { requestId: string };
  pending?: { question: string; requestId: string };
};
export const CHAT_RECOVERY_KEY = "pointup.assistant.tab.v1";
export const CHAT_RECOVERY_BYTES = 64 * 1024;
const TTL = 24 * 60 * 60 * 1000;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
let activeLease: object | undefined;
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 4000;
function valid(value: unknown): value is ChatRecovery {
  if (!object(value) || !keys(value, ["turns", "draft", "uncertain", "pending"]) || !text(value.draft)
    || !Array.isArray(value.turns) || value.turns.length > 40) return false;
  if (!value.turns.every(turn => object(turn) && keys(turn, ["role", "content", "shortened"])
    && (turn.role === "user" || turn.role === "assistant") && text(turn.content)
    && (turn.shortened === undefined || typeof turn.shortened === "boolean"))) return false;
  for (const field of ["uncertain", "pending"] as const) {
    const entry = value[field];
    if (entry !== undefined && (!object(entry) || !keys(entry, field === "pending" ? ["requestId", "question"] : ["requestId"])
      || !assistantSupportId(entry.requestId) || (field === "pending" && (!text(entry.question) || !entry.question.trim())))) return false;
  }
  return !(value.pending && value.uncertain);
}

/** A mounted panel owns one lease. Disposed/replaced panels cannot persist late responses. */
export class AssistantChatRecoverySession {
  private readonly lease = {};
  private disposed = false;
  constructor(private readonly owner: string, private readonly storage?: StoragePort, private readonly now = Date.now) {
    activeLease = this.lease;
  }
  isCurrent(): boolean { return !this.disposed && activeLease === this.lease; }
  dispose(): void { this.disposed = true; if (activeLease === this.lease) activeLease = undefined; }
  clear(): void { if (this.isCurrent()) { try { this.storage?.removeItem(CHAT_RECOVERY_KEY); } catch { /* optional recovery */ } } }
  restore(): ChatRecovery | undefined {
    if (!this.isCurrent()) return;
    try {
      const raw = this.storage?.getItem(CHAT_RECOVERY_KEY);
      if (!raw) return;
      if (new TextEncoder().encode(raw).byteLength > CHAT_RECOVERY_BYTES) { this.clear(); return; }
      const envelope: unknown = JSON.parse(raw);
      if (!object(envelope) || !keys(envelope, ["version", "owner", "savedAt", "chat"])
        || envelope.version !== 1 || envelope.owner !== this.owner || typeof envelope.savedAt !== "number"
        || !Number.isFinite(envelope.savedAt) || envelope.savedAt > this.now() || this.now() - envelope.savedAt >= TTL
        || !valid(envelope.chat)) { this.clear(); return; }
      const chat = envelope.chat;
      // An abandoned request is never replayed. Its reference describes an unknown outcome.
      return chat.pending ? { turns: chat.turns, draft: chat.pending.question, uncertain: { requestId: chat.pending.requestId } } : chat;
    } catch { this.clear(); return; }
  }
  save(chat: ChatRecovery): boolean {
    if (!this.isCurrent() || !this.storage || !valid(chat)) return false;
    try {
      const bounded = { ...chat, turns: chat.turns.slice(-40) };
      let raw: string;
      do {
        raw = JSON.stringify({ version: 1, owner: this.owner, savedAt: this.now(), chat: bounded });
        if (new TextEncoder().encode(raw).byteLength <= CHAT_RECOVERY_BYTES) break;
        if (!bounded.turns.length) return false;
        bounded.turns.shift();
      } while (true);
      this.storage.setItem(CHAT_RECOVERY_KEY, raw);
      return true;
    } catch {
      // A failed pending save must not leave an older confirmed snapshot behind.
      this.clear();
      return false;
    }
  }
}
