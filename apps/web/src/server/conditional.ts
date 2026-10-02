import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

/**
 * JSON response with a weak ETag derived from the body, honouring
 * `If-None-Match` with a bodyless 304. Saves transfer and client parse time
 * for polled reads (dashboard refresh, MCP clients); the body is still
 * computed server-side, so this is bandwidth, not CPU, relief.
 * `private, no-cache` keeps shared caches out and forces revalidation.
 */
export function jsonWithEtag(request: Request, body: unknown): NextResponse {
  const json = JSON.stringify(body);
  const etag = `W/"${createHash("sha256").update(json).digest("base64url").slice(0, 22)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  const candidates = request.headers.get("if-none-match");
  if (candidates && candidates.split(",").some((tag) => tag.trim() === etag || tag.trim() === "*")) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(json, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
