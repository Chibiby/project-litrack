import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Consumes the emailed recovery `token_hash` — the only place in this flow
 * that does. Reached exclusively via a same-origin form POST from
 * `/auth/confirm` (see that page for why GET must never call `verifyOtp`).
 *
 * Runs as a route handler, not a Server Component render, because the
 * resulting session cookies must actually be written to the response.
 *
 * Only `type=recovery` is accepted: this endpoint exists to land a password
 * reset, not to be a general-purpose OTP verifier for other Supabase link
 * types.
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

/**
 * Only this site's own /auth/confirm page may submit here. A cross-site form
 * could otherwise post an attacker's own token_hash and sign the visitor into
 * the attacker's account (login CSRF). Browsers send Sec-Fetch-Site on every
 * form POST; Origin is the fallback for older ones.
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
  const tokenHash = formData.get("token_hash");
  const type = formData.get("type");

  if (typeof tokenHash !== "string" || !tokenHash || type !== "recovery") {
    return invalidLinkRedirect(request);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) {
    // Never echo `error.message` — it can distinguish "expired" from
    // "already used" from "unknown token", which is more than a stranger
    // holding a stale link needs to learn.
    //
    // But "already used" also covers the ordinary case of a person who
    // clicked "Continue" once already (a second tab, the back button, a
    // retried submit): if this request already carries the session that
    // earlier verifyOtp call set, send them on to the reset page instead of
    // an error that isn't true for them anymore.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      return NextResponse.redirect(new URL("/auth/reset", request.url), 303);
    }
    return invalidLinkRedirect(request);
  }

  return NextResponse.redirect(new URL("/auth/reset", request.url), 303);
}
