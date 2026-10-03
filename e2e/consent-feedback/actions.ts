// Only server-action transport is synthetic; no auth/API/provider imports.
export type ActionResult =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export type CreateTokenResult =
  | ActionResult
  | { status: "created"; tokenId: string; secret: string };

export interface ConsentCall {
  number: number;
  kind: "grant" | "revoke";
  rowId: string;
}

export interface ConsentFixture {
  calls(): ConsentCall[];
  settle(number: number, outcome: "success" | "error"): void;
  grant(id: string): void;
  revoke(id: string): void;
  unmount(): void;
}

declare global {
  interface Window {
    consentFixture: ConsentFixture;
  }
}

let sequence = 0;
const pending = new Map<number, ConsentCall & {
  resolve(result: ActionResult): void;
}>();

function defer(kind: ConsentCall["kind"], data: FormData): Promise<ActionResult> {
  const rowId = String(data.get(kind === "grant" ? "providerId" : "consentId") ?? "");
  return new Promise(resolve => {
    const number = ++sequence;
    pending.set(number, { number, kind, rowId, resolve });
  });
}

export const calls = (): ConsentCall[] =>
  [...pending.values()].map(({ number, kind, rowId }) => ({ number, kind, rowId }));

export function settle(number: number, outcome: "success" | "error"): void {
  const call = pending.get(number);
  if (!call) throw new Error("Unknown synthetic call");
  pending.delete(number);
  call.resolve(outcome === "success"
    ? { status: "success" }
    : { status: "error", message: "Synthetic refusal: no change saved." });
}

export const grantConsentAction = (_previous: ActionResult, data: FormData) =>
  defer("grant", data);
export const revokeConsentAction = (_previous: ActionResult, data: FormData) =>
  defer("revoke", data);

const unsupported = async (): Promise<ActionResult> => ({
  status: "error",
  message: "Outside consent fixture scope.",
});
export const resolveReviewAction = unsupported;
export const revokeAccessTokenAction = unsupported;
export const createAccessTokenAction: () => Promise<CreateTokenResult> = unsupported;
