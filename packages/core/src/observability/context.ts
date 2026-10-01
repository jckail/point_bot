import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** Ambient per-request context (Node only). Carries the correlation id. */
export interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export const REQUEST_ID_HEADER = "x-request-id";

/** Accepted inbound ids: short, printable, no log-injection characters. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Accept the caller's x-request-id when well-formed, otherwise mint one. */
export function resolveRequestId(inbound: string | null | undefined): string {
  const candidate = inbound?.trim();
  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}
