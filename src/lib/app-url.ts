/**
 * The canonical public base URL of the site, shared by every emailed-link and
 * email-asset builder so they cannot disagree. Never derived from request
 * headers (client-controlled).
 */
export const CANONICAL_APP_URL = "https://arallitrack.com";

export function canonicalAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || CANONICAL_APP_URL).replace(/\/+$/, "");
}
