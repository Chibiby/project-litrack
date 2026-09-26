import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { parseAppMetadataRole, type AppRole } from "@/lib/auth/roles";
import { getSharedJwks } from "@/lib/supabase/jwks";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export type SessionUser = {
  id: string;
  /** Role from JWT app_metadata; null for legacy accounts without it. */
  role: AppRole | null;
};

/**
 * Refreshes the Supabase auth session cookie when needed and returns the
 * user identity from verified JWT claims. Use from middleware.ts.
 *
 * Uses auth.getClaims() (supabase-js 2.106+) which:
 * - Refreshes the session via getSession() when the access token is expired
 * - Verifies the JWT locally against JWKS when the project uses asymmetric
 *   signing keys (ES256/RS256) — no Auth-server round trip per request
 * - Falls back to getUser() only for legacy HS* symmetric JWTs
 *
 * Authoritative user lookups (ban/delete/pending gates) stay in RSC via
 * session.ts (getClaims + Prisma) — middleware only needs id + role for
 * redirect-if-authed and role-prefix gates.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (set these in Vercel for auth to work in production).
 */
export async function updateSession(request: NextRequest) {
  const env = getSupabasePublicEnv();

  // Avoid Edge crash when Supabase env is unset (e.g. fresh Vercel project).
  if (!env.ok) {
    return { supabaseResponse: NextResponse.next({ request }), user: null as SessionUser | null };
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[], headers: Record<string, string>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
        // A CDN or reverse proxy must never cache a response carrying one
        // user's auth Set-Cookie for the next visitor. @supabase/ssr hands us
        // the Cache-Control/Expires/Pragma headers that prevent that; apply
        // them to the response object we just (re)created.
        Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value));
      },
    },
  });

  let claimsResult: Awaited<ReturnType<typeof supabase.auth.getClaims>>;
  try {
    // Signed-out requests carry no Supabase cookie and getClaims returns before needing keys,
    // so skip the KV read for them (login page, bots, health checks).
    const hasSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
    const jwks = hasSession ? await getSharedJwks(env.url, env.anonKey) : undefined;
    claimsResult = await supabase.auth.getClaims(undefined, jwks ? { jwks } : undefined);
  } catch (err) {
    console.error("[middleware] getClaims failed:", err);
    return { supabaseResponse, user: null as SessionUser | null };
  }

  const { data, error } = claimsResult;

  if (error || !data?.claims?.sub) {
    return { supabaseResponse, user: null as SessionUser | null };
  }

  const claims = data.claims;
  const role = parseAppMetadataRole(claims.app_metadata?.role);
  const user: SessionUser = { id: claims.sub, role };

  return { supabaseResponse, user };
}
