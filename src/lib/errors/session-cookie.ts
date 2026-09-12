/**
 * Who was signed in, read from the request's Supabase cookie.
 *
 * The JWT signature is NOT verified, and this must never gate access. It exists
 * so a crashed page render can be filed under an account: `onRequestError` runs
 * outside the request's React scope, where `getCurrentUser()` is unavailable.
 * Records written from it are marked `userSource: "cookie"` so a reader knows
 * the attribution is a label, not a proof.
 */

const SESSION_COOKIE = /^sb-.+-auth-token(?:\.(\d+))?$/;

function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const raw = Array.isArray(header) ? header.join("; ") : (header ?? "");
  const out = new Map<string, string>();
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0) out.set(part.slice(0, eq).trim(), part.slice(eq + 1));
  }
  return out;
}

function decodeJwtSubject(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof json.sub === "string" && json.sub ? json.sub : null;
  } catch {
    return null;
  }
}

export function authIdFromCookieHeader(header: string | string[] | undefined): string | null {
  try {
    const cookies = parseCookies(header);
    const names = [...cookies.keys()].filter((name) => SESSION_COOKIE.test(name));
    if (names.length === 0) return null;

    // @supabase/ssr splits a large session across `.0`, `.1`, … in order.
    const base = names[0].replace(/\.\d+$/, "");
    const chunks = names
      .filter((name) => name === base || name.startsWith(`${base}.`))
      .sort((a, b) => Number(a.split(".").pop() ?? 0) - Number(b.split(".").pop() ?? 0));
    let value = chunks.map((name) => cookies.get(name) ?? "").join("");
    if (!value) return null;

    value = decodeURIComponent(value);
    if (value.startsWith("base64-")) {
      value = Buffer.from(value.slice("base64-".length), "base64url").toString("utf8");
    }

    const session = JSON.parse(value) as unknown;
    if (Array.isArray(session)) return decodeJwtSubject(session[0]);
    if (session && typeof session === "object") {
      return decodeJwtSubject((session as { access_token?: unknown }).access_token);
    }
    return null;
  } catch {
    // Attribution is a nicety; a malformed cookie must never cost us the error
    // record it was attached to.
    return null;
  }
}
