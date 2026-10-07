/**
 * Who was signed in, read from the request's Better Auth cookie.
 *
 * The cookie cache signature is NOT verified, and this must never gate access.
 * It exists so a crashed page render can be filed under an account:
 * `onRequestError` runs outside the request's React scope, where
 * `getCurrentUser()` is unavailable. Records written from it are marked
 * `userSource: "cookie"` so a reader knows the attribution is a label, not a
 * proof.
 *
 * The id comes from the compact session cache cookie (`litrack.session_data`,
 * base64url JSON holding `{ session: { session, user }, expiresAt, signature }`).
 * Once that cache has expired (five minutes after the last server-side session
 * read) there is nothing to read without a database, and the answer is null.
 */

const SESSION_DATA_COOKIE = /^(?:__Secure-)?litrack\.session_data$/;

function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const raw = Array.isArray(header) ? header.join("; ") : (header ?? "");
  const out = new Map<string, string>();
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0) out.set(part.slice(0, eq).trim(), part.slice(eq + 1));
  }
  return out;
}

export function authIdFromCookieHeader(header: string | string[] | undefined): string | null {
  try {
    const cookies = parseCookies(header);
    const name = [...cookies.keys()].find((n) => SESSION_DATA_COOKIE.test(n));
    if (!name) return null;

    const value = decodeURIComponent(cookies.get(name) ?? "");
    if (!value) return null;

    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      session?: { user?: { id?: unknown } };
    };
    const id = data?.session?.user?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    // Attribution is a nicety; a malformed cookie must never cost us the error
    // record it was attached to.
    return null;
  }
}
