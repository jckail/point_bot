import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewedAction } from "./assistant-action-contract";

const requests = vi.hoisted(() => ({ read: vi.fn(), review: vi.fn(), router: { refresh: vi.fn() } }));
const hooks = vi.hoisted((): { current?: HookHarness } => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => requests.router }));
vi.mock("./agent-api", async importOriginal => ({
  ...await importOriginal<typeof import("./agent-api")>(),
  agentRequest: requests.read, requestReviewedAction: requests.review,
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (value: unknown) => active().state(value),
  useRef: (value: unknown) => active().ref(value),
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => active().effect(effect, deps),
}));
import { ReviewedAssistantActions } from "./reviewed-assistant-actions";

// Generic persistent hook slots run the actual component, effects, cleanup,
// request gate and button handlers. This is not a React renderer/lifecycle.
function isInitializer(value: unknown): value is () => unknown { return typeof value === "function"; }
function isUpdater(value: unknown): value is (current: unknown) => unknown { return typeof value === "function"; }
type Slot = { kind: "state"; value: unknown } | { kind: "ref"; value: { current: unknown } }
  | { kind: "effect"; deps?: readonly unknown[]; cleanup?: () => void };
class HookHarness {
  private slots: Slot[] = [];
  private cursor = 0;
  private effects: Array<() => void> = [];
  dirty = true;
  tree: ReactNode = null;
  state(value: unknown) {
    const index = this.cursor++;
    let slot = this.slots[index];
    if (!slot) { slot = { kind: "state", value: isInitializer(value) ? value() : value }; this.slots[index] = slot; }
    if (slot.kind !== "state") throw new Error("Hook slot mismatch");
    const target = slot;
    return [target.value, (next: unknown) => {
      target.value = isUpdater(next) ? next(target.value) : next; this.dirty = true;
    }];
  }
  ref(value: unknown) {
    const index = this.cursor++;
    let slot = this.slots[index];
    if (!slot) { slot = { kind: "ref", value: { current: value } }; this.slots[index] = slot; }
    if (slot.kind !== "ref") throw new Error("Hook slot mismatch");
    return slot.value;
  }
  effect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const index = this.cursor++; const previous = this.slots[index];
    if (previous && previous.kind !== "effect") throw new Error("Hook slot mismatch");
    if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps?.[i]))) return;
    const next: Slot = { kind: "effect", deps }; this.slots[index] = next;
    this.effects.push(() => { previous?.cleanup?.(); const cleanup = effect(); if (typeof cleanup === "function") next.cleanup = cleanup; });
  }
  render() {
    hooks.current = this; this.cursor = 0; this.dirty = false;
    this.tree = ReviewedAssistantActions({});
    const effects = this.effects; this.effects = []; for (const effect of effects) effect();
  }
  async flush() {
    // Bounded microtask drain only; deferred requests remain explicitly held.
    for (let i = 0; i < 12; i++) { if (this.dirty) this.render(); await Promise.resolve(); }
  }
  html() { return renderToStaticMarkup(this.tree); }
  dispose() { for (const slot of this.slots) if (slot.kind === "effect") slot.cleanup?.(); hooks.current = undefined; }
}
function active() { if (!hooks.current) throw new Error("Missing component harness"); return hooks.current; }
function button(node: ReactNode, label: string): { onClick?: () => void; disabled?: boolean } | undefined {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return undefined;
  if (node.type === "button" && Children.toArray(node.props.children).join("") === label) return node.props;
  for (const child of Children.toArray(node.props.children)) { const found = button(child, label); if (found) return found; }
  return undefined;
}
async function click(h: HookHarness, label: string) {
  const found = button(h.tree, label); if (!found?.onClick) throw new Error(`Missing button ${label}`);
  expect(found.disabled).not.toBe(true); found.onClick(); await h.flush();
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function action(status: ReviewedAction["status"], id = "synthetic-action"): ReviewedAction {
  return { id, kind: "manual_balance", status, title: "Synthetic balance", summary: "Synthetic proposal",
    createdAt: "2026-10-03T00:00:00Z", expiresAt: "2026-10-03T00:15:00Z", updatedAt: "2026-10-03T00:00:00Z",
    payload: { accountId: "synthetic-account", providerId: "united", providerName: "United", points: 123, capturedAt: "2026-10-03T00:00:00Z" }, result: null, failureCode: null };
}
let h: HookHarness;
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-03T00:01:00Z"));
  vi.stubGlobal("window", { setInterval: vi.fn().mockReturnValue(1), clearInterval: vi.fn() });
  h = new HookHarness();
});
afterEach(() => { h.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(status: ReviewedAction["status"] = "pending") {
  requests.read.mockResolvedValueOnce({ actions: [action(status)] }); await h.flush();
}

describe("actual proposal component reconciles canonical portfolio refresh", () => {
  it("recovers a lost approval reply via one explicit successful GET, without resending approval or repeating refresh", async () => {
    await mount(); requests.review.mockRejectedValueOnce(new Error("Synthetic lost reply"));
    await click(h, "Approve balance update");
    expect(h.html()).toContain("Result unconfirmed"); expect(requests.router.refresh).not.toHaveBeenCalled();
    requests.read.mockResolvedValueOnce({ actions: [action("succeeded")] }); await click(h, "Refresh");
    expect(h.html()).toContain("Change applied"); expect(requests.router.refresh).toHaveBeenCalledOnce();
    requests.read.mockResolvedValueOnce({ actions: [action("succeeded")] }); await click(h, "Refresh");
    expect(requests.router.refresh).toHaveBeenCalledOnce(); expect(requests.review).toHaveBeenCalledExactlyOnceWith("synthetic-action", "approve");
  });
  it("refreshes when an executing approval later resolves as succeeded in an accepted list", async () => {
    await mount(); requests.review.mockResolvedValueOnce({ action: action("executing") }); await click(h, "Approve balance update");
    expect(requests.router.refresh).not.toHaveBeenCalled(); expect(h.html()).toContain("being applied");
    requests.read.mockResolvedValueOnce({ actions: [action("succeeded")] }); await click(h, "Refresh");
    expect(requests.router.refresh).toHaveBeenCalledOnce(); expect(h.html()).toContain("Change applied");
  });
  it("does not refresh historical success on mount, but acknowledges explicit reconciliation once", async () => {
    await mount("succeeded"); expect(requests.router.refresh).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) { requests.read.mockResolvedValueOnce({ actions: [action("succeeded")] }); await click(h, "Refresh"); }
    expect(requests.router.refresh).toHaveBeenCalledOnce();
  });
  it("does not refresh the same successful POST again when it appears in later GET responses", async () => {
    await mount(); requests.review.mockResolvedValueOnce({ action: action("succeeded") }); await click(h, "Approve balance update");
    expect(requests.router.refresh).toHaveBeenCalledOnce();
    requests.read.mockResolvedValueOnce({ actions: [action("succeeded")] }); await click(h, "Refresh");
    expect(requests.router.refresh).toHaveBeenCalledOnce();
  });
  it.each(["pending", "executing", "unknown", "failed", "rejected", "expired"] as const)("does not claim portfolio change for an accepted %s list", async status => {
    await mount(); requests.read.mockResolvedValueOnce({ actions: [action(status)] }); await click(h, "Refresh");
    expect(requests.router.refresh).not.toHaveBeenCalled(); expect(requests.review).not.toHaveBeenCalled();
  });
  it.each(["transport", "malformed"] as const)("does not refresh or replace pending proposals on %s GET failure", async failure => {
    await mount();
    if (failure === "transport") requests.read.mockRejectedValueOnce(new Error("Synthetic read failure"));
    else requests.read.mockResolvedValueOnce({ actions: [{ ...action("succeeded"), payload: {} }] });
    await click(h, "Refresh");
    expect(h.html()).toContain('role="alert"'); expect(h.html()).toContain("Waiting for your review");
    expect(requests.router.refresh).not.toHaveBeenCalled(); expect(requests.review).not.toHaveBeenCalled();
  });
  it("ignores a succeeded stale GET after a newer canonical pending read", async () => {
    await mount(); const old = deferred<unknown>(); requests.read.mockReturnValueOnce(old.promise); await click(h, "Refresh");
    requests.read.mockResolvedValueOnce({ actions: [action("pending")] }); await click(h, "Refresh");
    old.resolve({ actions: [action("succeeded")] }); await h.flush();
    expect(h.html()).toContain("Waiting for your review"); expect(requests.router.refresh).not.toHaveBeenCalled();
  });
  it("ignores succeeded reads invalidated by an in-flight review and never retries an unknown decision", async () => {
    await mount(); const read = deferred<unknown>(); requests.read.mockReturnValueOnce(read.promise); await click(h, "Refresh");
    const review = deferred<unknown>(); requests.review.mockReturnValueOnce(review.promise); await click(h, "Approve balance update");
    expect(button(h.tree, "Refresh")?.disabled).toBe(true);
    read.resolve({ actions: [action("succeeded")] }); await h.flush(); expect(requests.router.refresh).not.toHaveBeenCalled();
    review.resolve({ action: action("unknown") }); await h.flush();
    expect(h.html()).toContain("Do not retry this action"); expect(button(h.tree, "Approve balance update")).toBeUndefined();
    expect(requests.review).toHaveBeenCalledOnce(); expect(requests.router.refresh).not.toHaveBeenCalled();
  });
  it("can reconcile succeeded data on the first explicit Refresh after initial GET failed", async () => {
    requests.read.mockRejectedValueOnce(new Error("Synthetic initial read failure")); await h.flush();
    requests.read.mockResolvedValueOnce({ actions: [action("succeeded")] }); await click(h, "Refresh");
    expect(h.html()).toContain("Change applied"); expect(requests.router.refresh).toHaveBeenCalledOnce();
  });
  it("batches newly acknowledged successful IDs into one refresh and ignores their duplicate reads", async () => {
    await mount(); const result = { actions: [action("succeeded"), action("succeeded", "second-synthetic-action")] };
    requests.read.mockResolvedValueOnce(result); await click(h, "Refresh"); expect(requests.router.refresh).toHaveBeenCalledOnce();
    requests.read.mockResolvedValueOnce(result); await click(h, "Refresh"); expect(requests.router.refresh).toHaveBeenCalledOnce();
  });
});
