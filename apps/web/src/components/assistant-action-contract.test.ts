import { describe, expect, it } from "vitest";
import { AssistantActionRequestGate } from "./assistant-action-request-gate";
import { canReviewAction, reviewActionDetails, reviewedActionSchema } from "./assistant-action-contract";

const base = { id: "action-id", status: "pending", title: "Display title", summary: "Display summary", createdAt: "2026-10-01T10:00:00Z", expiresAt: "2026-10-01T11:00:00Z", updatedAt: "2026-10-01T10:00:00Z", result: null, failureCode: null };
const balance = { ...base, kind: "manual_balance", payload: { accountId: "exact-account", providerName: "United", providerId: "united", points: 125000, capturedAt: "2026-10-01T09:30:00Z" } };

describe("reviewed action contract", () => {
  it("permits review only for an unexpired pending action", () => {
    const action = reviewedActionSchema.parse(balance);
    expect(canReviewAction(action, Date.parse("2026-10-01T10:30:00Z"))).toBe(true);
    expect(canReviewAction(action, Date.parse(action.expiresAt))).toBe(false);
    for (const status of ["executing", "succeeded", "rejected", "expired", "failed", "unknown"] as const) {
      expect(canReviewAction({ ...action, status }, Date.parse("2026-10-01T10:30:00Z"))).toBe(false);
    }
  });
  it("includes the exact account, points and capture time in a balance review", () => {
    expect(reviewActionDetails(reviewedActionSchema.parse(balance))).toEqual([
      { label: "Program", value: "United" }, { label: "Account", value: "exact-account" },
      { label: "New balance", value: "125,000 points" }, { label: "Captured at", value: "2026-10-01T09:30:00Z" },
    ]);
  });
  it("includes every goal value without interpreting user content", () => {
    const action = reviewedActionSchema.parse({ ...base, kind: "trip_goal", payload: { title: "<script>changeAccount()</script>", targetPoints: 80000, targetDate: "2027-03-12", accountIds: ["account-a", "account-b"], accountNames: ["United", "Hyatt"], notes: "Keep both balances" } });
    const values = reviewActionDetails(action).map(detail => detail.value);
    expect(values).toEqual(["<script>changeAccount()</script>", "80,000 points", "2027-03-12", "United, Hyatt", "account-a, account-b", "Keep both balances"]);
  });
  it("refuses unsupported executable actions and unsafe point values", () => {
    expect(reviewedActionSchema.safeParse({ ...balance, kind: "execute_command", payload: { command: "transfer points" } }).success).toBe(false);
    expect(reviewedActionSchema.safeParse({ ...balance, payload: { ...balance.payload, points: Number.MAX_SAFE_INTEGER + 1 } }).success).toBe(false);
    expect(reviewedActionSchema.safeParse({ ...balance, payload: { ...balance.payload, points: -1 } }).success).toBe(false);
  });
});

describe("assistant action list/review races", () => {
  it("does not let an earlier list snapshot restore pending status after approval", () => {
    const gate = new AssistantActionRequestGate();
    const earlierList = gate.beginRead()!;
    let displayedStatus = "pending";
    expect(gate.beginReview()).toBe(true);
    displayedStatus = "succeeded";
    gate.finishReview();
    if (gate.canApplyRead(earlierList)) displayedStatus = "pending";
    expect(displayedStatus).toBe("succeeded");
  });
  it("preserves an uncertain outcome against older reads and permits a later canonical refresh", () => {
    const gate = new AssistantActionRequestGate();
    const earlierList = gate.beginRead()!;
    expect(gate.beginReview()).toBe(true);
    expect(gate.beginRead()).toBeNull();
    expect(gate.canApplyRead(earlierList)).toBe(false);
    let blockedId: string | null = "action-id";
    gate.finishReview();
    if (gate.canApplyRead(earlierList)) blockedId = null;
    expect(blockedId).toBe("action-id");
    const canonicalRefresh = gate.beginRead()!;
    expect(gate.canApplyRead(canonicalRefresh)).toBe(true);
    if (gate.canApplyRead(canonicalRefresh)) blockedId = null;
    expect(blockedId).toBeNull();
  });
  it("ignores older overlapping reads and duplicate review starts", () => {
    const gate = new AssistantActionRequestGate();
    const first = gate.beginRead()!;
    const second = gate.beginRead()!;
    expect(gate.canApplyRead(first)).toBe(false);
    expect(gate.canApplyRead(second)).toBe(true);
    expect(gate.beginReview()).toBe(true);
    expect(gate.beginReview()).toBe(false);
    expect(gate.canApplyRead(second)).toBe(false);
  });
});
