import { expect, it, vi } from "vitest";
import { renderChat } from "../src/chat-view";
import type { ChatEntry } from "../src/messages";

class Element {
  textContent = "";
  className = "";
  scrollTop = 0;
  scrollHeight = 10;
  replacements = 0;
  readonly children: Element[] = [];
  readonly listeners: Record<string, () => void> = {};
  constructor(readonly tag: string) {}
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.replacements++; this.children.length = 0; }
  addEventListener(name: string, callback: () => void) { this.listeners[name] = callback; }
}
it("renders replies and proposals as text and gives only web review controls", () => {
  vi.stubGlobal("document", { createElement: (tag: string) => new Element(tag) });
  const log = new Element("div"); const review = vi.fn();
  renderChat(log as unknown as HTMLElement, [{ role: "assistant", content: "<script>private</script>", requestId: "support_1",
    actions: [{ id: "a", kind: "goal.create", title: "<img onerror=run()>", summary: "Review a goal", status: "proposed", expiresAt: "tomorrow" }] }], review);
  expect(log.children[0]?.textContent).toBe("PointUp: <script>private</script>");
  expect(log.children[1]?.textContent).toContain("support_1");
  const card = log.children[2]!;
  expect(card.children[0]?.textContent).toBe("<img onerror=run()> • Last returned status: proposed");
  expect(card.children.some(child => child.textContent.includes("saved snapshot"))).toBe(true);
  const buttons = card.children.filter(child => child.tag === "button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.textContent).toBe("Review in PointUp");
  buttons[0]?.listeners.click?.(); expect(review).toHaveBeenCalledTimes(1);
  renderChat(log as unknown as HTMLElement, [], review);
  expect(log.children).toEqual([]);
  vi.unstubAllGlobals();
});
it("keeps unchanged transcript node identity and the current review callback without scrolling or replacing the live log", () => {
  vi.stubGlobal("document", { createElement: (tag: string) => new Element(tag) });
  const log = new Element("div"), firstReview = vi.fn(), currentReview = vi.fn();
  const chat: ChatEntry[] = [{ role: "assistant", content: "Saved answer", actions: [{ id: "a", kind: "manual_balance",
    title: "Balance update", summary: "Review it", status: "pending", expiresAt: "2026-10-02T12:00:00Z" }] }];
  renderChat(log as unknown as HTMLElement, chat, firstReview);
  const answer = log.children[0], card = log.children[1];
  const button = card!.children.find(child => child.tag === "button")!;
  log.scrollTop = 3;
  renderChat(log as unknown as HTMLElement, structuredClone(chat), currentReview);
  expect(log.replacements).toBe(1);
  expect(log.children[0]).toBe(answer);
  expect(log.children[1]).toBe(card);
  expect(log.scrollTop).toBe(3);
  button.listeners.click?.();
  expect(currentReview).toHaveBeenCalledTimes(1);
  expect(firstReview).not.toHaveBeenCalled();
  renderChat(log as unknown as HTMLElement, [...chat, { role: "user", content: "New question" }], currentReview);
  expect(log.replacements).toBe(2);
  expect(log.children[0]).not.toBe(answer);
  expect(log.children.at(-1)?.textContent).toBe("You: New question");
  renderChat(log as unknown as HTMLElement, [], currentReview);
  expect(log.children).toEqual([]);
  expect(log.replacements).toBe(3);
  vi.unstubAllGlobals();
});
