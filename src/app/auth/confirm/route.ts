import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server-side landing pad for a password recovery email.
 *
 * `src/lib/auth/recovery-email.ts` builds the emailed link as
 * `/auth/confirm?token_hash=...&type=recovery` instead of handing back
 * Supabase's own `action_link`, because that link (a) falls back to the
 * project's Site URL when `redirectTo` isn't allowlisted and (b) delivers the
 * session as `#access_token=...` URL-hash fragments a server can never read.
 * `verifyOtp` here exchanges the token server-side and — because this runs in
 * a route handler, not a Server Component — the resulting session cookies are
 * actually written to the response.
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
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<Response> {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (!tokenHash || type !== "recovery") {
    return invalidLinkRedirect(request);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) {
    // Never echo `error.message` — it can distinguish "expired" from "already
    // used" from "unknown token", which is more than a stranger holding a
    // stale link needs to learn.
    return invalidLinkRedirect(request);
  }

  return NextResponse.redirect(new URL("/auth/reset", request.url));
}
