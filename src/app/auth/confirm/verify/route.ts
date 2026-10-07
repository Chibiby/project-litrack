import { NextResponse, type NextRequest } from "next/server";
import { peekResetToken } from "@/lib/auth/password-reset";
import { authCookiesSecure } from "@/lib/auth/auth-cookies";
import { RESET_COOKIE, RESET_COOKIE_PATH } from "@/lib/auth/recovery-email";

/**
 * Lands the emailed recovery token. Reached exclusively via a same-origin form
 * POST from `/auth/confirm` (see that page for why a GET must never act on the
 * token).
 *
 * The token is checked here but NOT used up: `completePasswordReset` consumes
 * it in the same transaction that writes the new password, so an abandoned
 * reset page leaves the link working until it expires. What this route does is
 * move the token out of the URL and into an httpOnly cookie scoped to `/auth`,
 * so nothing past `/auth/confirm` ever carries it in a URL (history, Referer,
 * logs).
 *
 * Only `type=recovery` is accepted: this endpoint lands a password reset and
 * nothing else.
 */

export const dynamic = "force-dynamic";

const INVALID_LINK_MESSAGE = "This reset link is invalid or has expired. Request a new one.";

function invalidLinkRedirect(request: NextRequest): NextResponse {
  const url = new URL("/auth/reset", request.url);
  url.searchParams.set("error", INVALID_LINK_MESSAGE);
  // 303: this response answers a POST, and the browser must GET /auth/reset
  // rather than replay the form submission against it.
  return NextResponse.redirect(url, 303);
}

function resetPageRedirect(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/auth/reset", request.url), 303);
}

/**
 * Only this site's own /auth/confirm page may submit here. A cross-site form
 * could otherwise post an attacker's own token and plant it in the visitor's
 * browser (login CSRF). Browsers send Sec-Fetch-Site on every form POST;
 * Origin is the fallback for older ones.
 */
function isSameOriginPost(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  if (origin) return origin === request.nextUrl.origin;
  return true;
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOriginPost(request)) {
    return invalidLinkRedirect(request);
  }
  const formData = await request.formData();
  const token = formData.get("token_hash");
  const type = formData.get("type");

  if (typeof token !== "string" || !token || type !== "recovery") {
    return invalidLinkRedirect(request);
  }

  const live = await peekResetToken(token);
  if (!live) {
    // Never say which: "expired", "already used" and "unknown" are more than a
    // stranger holding a stale link needs to learn.
    //
    // But "already used" also covers a person who clicked "Continue" once
    // already (a second tab, the back button, a retried submit) and still
    // holds a live reset cookie from that click: send them on to the reset
    // page instead of an error that isn't true for them.
    const existing = request.cookies.get(RESET_COOKIE)?.value;
    if (existing && (await peekResetToken(existing))) {
      return resetPageRedirect(request);
    }
    return invalidLinkRedirect(request);
  }

  const response = resetPageRedirect(request);
  const remainingSeconds = Math.floor((live.expiresAt.getTime() - Date.now()) / 1000);
  response.cookies.set(RESET_COOKIE, token, {
    httpOnly: true,
    secure: authCookiesSecure(),
    sameSite: "lax",
    path: RESET_COOKIE_PATH,
    maxAge: Math.max(remainingSeconds, 1),
  });
  return response;
}
