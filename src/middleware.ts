import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function isPublicPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/admin/login" ||
    pathname.startsWith("/teacher-setup/") ||
    pathname.startsWith("/api/schools/list") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Vercel must set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY for auth.
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseConfigured) {
    if (isPublicPath(pathname)) {
      return NextResponse.next();
    }
    const loginUrl = pathname.startsWith("/admin")
      ? new URL("/admin/login", request.url)
      : new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const { supabaseResponse, user } = await updateSession(request);

  // Allow public paths and the admin login
  if (isPublicPath(pathname)) {
    return supabaseResponse;
  }

  // All other routes require an authenticated user
  if (!user) {
    const loginUrl = pathname.startsWith("/admin")
      ? new URL("/admin/login", request.url)
      : new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Role enforcement is performed in server components via requireUser(role).
  // Middleware only ensures a session exists.
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
