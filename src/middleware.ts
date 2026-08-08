import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { enforceRolePrefix, roleHomePath } from "@/lib/auth/roles";

function isPublicPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/admin/login" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/auth/reset") ||
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  );
}

/** Paths that must not pay for session refresh / JWT verify. */
function skipsSessionUpdate(pathname: string) {
  return pathname.startsWith("/api/") || pathname === "/api";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Vercel must set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY for auth.
  if (!isSupabaseConfigured()) {
    if (isPublicPath(pathname)) {
      return NextResponse.next();
    }
    const loginUrl = pathname.startsWith("/admin")
      ? new URL("/admin/login", request.url)
      : new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Anonymous public API: skip updateSession entirely.
  // Keep updateSession for /login and /admin/login (redirect-if-authed needs user).
  if (skipsSessionUpdate(pathname)) {
    return NextResponse.next();
  }

  const { supabaseResponse, user } = await updateSession(request);

  // Already authenticated users with a known JWT role visiting login → role home
  if (user?.role && (pathname === "/login" || pathname === "/admin/login")) {
    return NextResponse.redirect(new URL(roleHomePath(user.role), request.url));
  }

  if (isPublicPath(pathname)) {
    return supabaseResponse;
  }

  if (!user) {
    const loginUrl = pathname.startsWith("/admin")
      ? new URL("/admin/login", request.url)
      : new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const gate = enforceRolePrefix(pathname, user.role);
  if (!gate.ok) {
    return NextResponse.redirect(new URL(gate.redirectTo, request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image
     * - favicon, public assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
