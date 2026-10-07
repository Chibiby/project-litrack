import { NextResponse, type NextRequest } from "next/server";
import { authedLoginRedirect, enforceRolePrefix } from "@/lib/auth/roles";
import {
  hasAuthSessionCookie,
  hasLegacySupabaseCookie,
  legacySupabaseCookieNames,
  readEdgeSession,
} from "@/lib/auth/auth-cookies";
import { loginPath } from "@/lib/auth/session-end";
import {
  FRESH_READ_COOKIE,
  FRESH_READ_WINDOW_SECONDS,
  isServerActionRequest,
} from "@/lib/db/read-consistency";

/**
 * Which login a signed-out visitor is sent to. Super Admins and district admins
 * both sign in at `/admin/login`. `/district` is matched as a whole segment so
 * an unrelated `/districtfoo` is not treated as an admin area.
 */
function loginAreaFor(pathname: string): "admin" | "school" {
  return pathname.startsWith("/admin") ||
    pathname === "/district" ||
    pathname.startsWith("/district/")
    ? "admin"
    : "school";
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/admin/login" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/auth/reset") ||
    pathname.startsWith("/auth/confirm") ||
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

  // Anonymous public API: no session work at all.
  if (skipsSessionUpdate(pathname)) {
    return NextResponse.next();
  }

  const cookieNames = request.cookies
    .getAll()
    .filter((cookie) => cookie.value)
    .map((cookie) => cookie.name);
  // Leftover cookies from before the move to Better Auth are expired on
  // whatever response this request gets. A legacy session cookie counts as
  // "had a session", so the forced sign-out says "session expired" instead of
  // showing a bare login page.
  const legacyCookies = legacySupabaseCookieNames(cookieNames);
  const hadSession = hasAuthSessionCookie(cookieNames) || hasLegacySupabaseCookie(cookieNames);

  const finish = (response: NextResponse): NextResponse => {
    for (const name of legacyCookies) {
      response.cookies.set(name, "", { maxAge: 0, path: "/" });
    }
    return response;
  };

  // Role comes from the signed cookie cache only. Non-authoritative: when the
  // cache has expired the role is null and the request passes through to
  // `requireUser`, which re-reads the User row.
  const user = await readEdgeSession(request);

  // Already authenticated users with a known role *loading* a login page →
  // role home. Server Action POSTs to /login must pass; see authedLoginRedirect.
  const loginBounce = authedLoginRedirect(request.method, pathname, user?.role ?? null);
  if (loginBounce) {
    return finish(NextResponse.redirect(new URL(loginBounce, request.url)));
  }

  if (isPublicPath(pathname)) {
    return finish(NextResponse.next());
  }

  if (!user) {
    return finish(
      NextResponse.redirect(
        new URL(
          loginPath(loginAreaFor(pathname), hadSession ? "session_expired" : null),
          request.url
        )
      )
    );
  }

  const gate = enforceRolePrefix(pathname, user.role);
  if (!gate.ok) {
    return finish(NextResponse.redirect(new URL(gate.redirectTo, request.url)));
  }

  const response = finish(NextResponse.next());

  // A Server Action is a write. Open this browser's read-your-writes window so
  // the refresh that follows skips Hyperdrive's query cache.
  if (isServerActionRequest(request.method, (name) => request.headers.get(name))) {
    response.cookies.set(FRESH_READ_COOKIE, "1", {
      maxAge: FRESH_READ_WINDOW_SECONDS,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image
     * - favicon, public assets
     * - /brand/** — static brand files served from public/. The extension list
     *   below covers images only, so the Apache Spark preloader (.js) would
     *   otherwise be treated as a page and redirected to /login for anonymous
     *   visitors — which is exactly who sees the first-load intro.
     */
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
