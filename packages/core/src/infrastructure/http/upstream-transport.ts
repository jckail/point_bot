/** Validate configured upstreams before credentials or private bodies reach fetch. */
export function upstreamBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Upstream URL is invalid."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (/[\s\\]/.test(value) || value.includes("?") || value.includes("#") || url.username || url.password ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("Upstream URL requires HTTPS without credentials, query or fragment; HTTP is allowed only on loopback.");
  }
  return url.href.replace(/\/$/, "");
}

/** Error responses are never read or copied into diagnostics. */
export async function discardUpstreamBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* Private cancellation details stay private. */ }
}

/** Bound real response reads incrementally, including chunked bodies with no length header. */
export async function boundedUpstreamJson(response: Response, maxBytes: number): Promise<unknown> {
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error();
    if (!response.body) {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error();
      return JSON.parse(text);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) {
          try { await reader.cancel(); } catch { /* Keep the fixed failure. */ }
          throw new Error();
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw new Error("Upstream response is unavailable."); }
}
