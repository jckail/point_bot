/** Bounded JSON parsing shared by mutation routes. */
export class RequestBodyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readJsonBody(request: Request, allowEmpty = false): Promise<unknown> {
  // CSV import is JSON encoded; leave room for exported portfolios while bounding memory.
  const maxBytes = 2 * 1024 * 1024;
  const reader = request.body?.getReader();
  if (!reader) {
    if (allowEmpty) return {};
    throw new RequestBodyError(400, "INVALID_REQUEST", "A JSON request body is required");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(413, "REQUEST_TOO_LARGE", "Request body exceeds 2 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0 && allowEmpty) return {};
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    throw new RequestBodyError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestBodyError(400, "INVALID_REQUEST", "Request body must contain valid JSON");
  }
}
