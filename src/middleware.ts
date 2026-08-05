import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/admin/login",
  "/teacher-setup",
  "/api/schools/list",
];

const ADMIN_PATHS = ["/admin"];
const SCHOOL_HEAD_PATHS = ["/school-head"];
const TEACHER_PATHS = ["/teacher"];

function isPathPrefixed(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabaseResponse, user } = await updateSession(request);

  // Allow public paths and the admin login
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/admin/login" ||
    pathname.startsWith("/teacher-setup/") ||
    pathname.startsWith("/api/schools/list") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
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
