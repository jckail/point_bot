import type { ExtractedBalance } from "./extraction";
import { guidedProviderForUrl } from "./providers";

export const CAPTURE_TTL_MS = 10 * 60 * 1000;
export interface ReviewedCapture extends ExtractedBalance {
  readonly id: string;
  readonly sourceOrigin: string;
  readonly capturedAt: number;
  readonly sourceUrl?: string;
  readonly sourceMethod?: "page_capture" | "manual_entry";
  readonly lockedAccountId?: string;
}

/** Only secure API origins, with loopback HTTP for local development. */
export function apiOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Enter an API origin only, without a path, credentials, or query.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP on localhost for development.");
  }
  return url.origin;
}

export function providerForUrl(raw: string): string | null { return guidedProviderForUrl(raw); }

export function isReviewedCapture(value: unknown, now = Date.now()): value is ReviewedCapture {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<ReviewedCapture>;
  return typeof c.id === "string" && c.id.length > 0 && typeof c.sourceOrigin === "string"
    && providerForUrl(c.sourceOrigin) === c.providerId
    && (c.sourceUrl === undefined || providerForUrl(c.sourceUrl) === c.providerId)
    && (c.sourceMethod === undefined || ["page_capture", "manual_entry"].includes(c.sourceMethod))
    && typeof c.points === "number"
    && Number.isSafeInteger(c.points) && c.points >= 0 && typeof c.capturedAt === "number"
    && c.capturedAt <= now && now - c.capturedAt < CAPTURE_TTL_MS;
}

export function isPopupSender(sender: { id?: string; url?: string; tab?: unknown }, runtimeId: string, popupUrl: string): boolean {
  return sender.id === runtimeId && sender.url === popupUrl && !sender.tab;
}
