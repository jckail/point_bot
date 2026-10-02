export const INVALID_API_URL = "Use an HTTPS PointUp page URL or a local development URL without credentials, query parameters or a fragment.";
export const LEGACY_API_URL = "Your saved API URL includes a page path. Save settings again to use the PointUp origin. Existing pending captures keep their original identity; check PointUp before discarding and recapturing them.";

/** New explicit settings may be pasted from an app page, but never include secrets. */
export function canonicalApiOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(INVALID_API_URL); }
  if (url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error(INVALID_API_URL);
  }
  return url.origin;
}

/** Reading old storage must not normalize the identity of an already frozen request. */
export function configuredApiOrigin(value: string): string {
  const origin = canonicalApiOrigin(value);
  if (new URL(value).pathname !== "/") throw new Error(LEGACY_API_URL);
  return origin;
}
