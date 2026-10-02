import { expect, it, vi } from "vitest";
import { renderChat } from "../src/chat-view";

class Element {
  textContent = "";
  className = "";
  scrollTop = 0;
  scrollHeight = 10;
  readonly children: Element[] = [];
  readonly listeners: Record<string, () => void> = {};
  constructor(readonly tag: string) {}
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children.length = 0; }
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
  expect(card.children[0]?.textContent).toBe("<img onerror=run()> • proposed");
  const buttons = card.children.filter(child => child.tag === "button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.textContent).toBe("Review in PointUp");
  buttons[0]?.listeners.click?.(); expect(review).toHaveBeenCalledTimes(1);
  renderChat(log as unknown as HTMLElement, [], review);
  expect(log.children).toEqual([]);
  vi.unstubAllGlobals();
});
